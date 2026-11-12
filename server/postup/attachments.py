import io
import re
import unicodedata
import warnings
from threading import BoundedSemaphore

from django.conf import settings
from django.core.exceptions import SuspiciousOperation
from django.db import DatabaseError, transaction
from django.db.models import Sum
from django.http import FileResponse, JsonResponse
from django.http.multipartparser import MultiPartParserError
from django.views.decorators.http import require_GET, require_http_methods
from PIL import Image, ImageOps
from pypdf import PdfReader
from pypdf.errors import PyPdfError

from .api import ApiError, endpoint, invalid, json_body, throttled
from .models import Attachment, AttachmentContent, User
from .portfolio import (
    check_revision, event, get_record, lock_student, missing, record_data, require_editable_evidence, update_record, uuid_field,
)

IMAGE_TYPES = {"JPEG": ("image/jpeg", ".jpg"), "PNG": ("image/png", ".png")}
FILE_TYPES = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png"}
validate_slot = BoundedSemaphore(1)


def validate_pdf(raw):
    if not re.match(rb"%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)", raw) or not raw.rstrip().endswith(b"%%EOF"):
        raise ValueError("PDF header or footer")
    reader = PdfReader(io.BytesIO(raw), strict=True)
    if reader.is_encrypted or not 1 <= len(reader.pages) <= 100:
        raise ValueError("PDF page count or encryption")
    for page in reader.pages:
        if page.get("/Type") != "/Page":
            raise ValueError("PDF page tree")


def normalize_image(raw):
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw), formats=list(IMAGE_TYPES)) as image:
            extension = IMAGE_TYPES[image.format][1]
            width, height = image.size
            if width * height > settings.ATTACHMENT_PIXELS or max(width, height) > 10000 or getattr(image, "n_frames", 1) != 1:
                invalid({"file": "Зображення завелике або містить кілька кадрів."})
            image.verify()
        with Image.open(io.BytesIO(raw), formats=list(IMAGE_TYPES)) as image:
            normalized = ImageOps.exif_transpose(image).convert(
                "RGBA" if extension == ".png" and (image.has_transparency_data or "A" in image.getbands()) else "RGB",
            )
            normalized.info.clear()
            output = io.BytesIO()
            if extension == ".jpg":
                normalized.save(output, format="JPEG", quality=92, subsampling=0)
            else:
                normalized.save(output, format="PNG")
            return output.getvalue(), extension


def validated_file(upload):
    if upload.size < 1 or upload.size > settings.ATTACHMENT_BYTES:
        invalid({"file": f"Файл має бути меншим за {settings.ATTACHMENT_BYTES // (1024 * 1024)} МБ або дорівнювати цьому ліміту."})
    raw = upload.read(settings.ATTACHMENT_BYTES + 1)
    if not validate_slot.acquire(blocking=False):
        raise ApiError("busy", "Сервер обробляє інший документ. Повторіть завантаження.", 429)
    try:
        if raw.startswith(b"%PDF-"):
            validate_pdf(raw)
            contents, extension = raw, ".pdf"
        else:
            contents, extension = normalize_image(raw)
    except (PyPdfError, OSError, ValueError, SyntaxError, KeyError, TypeError, AttributeError, IndexError, OverflowError, RecursionError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        invalid({"file": "Виберіть коректний PDF, JPEG або PNG. Захищені паролем PDF не підтримуються."})
    finally:
        validate_slot.release()
    if len(contents) > settings.ATTACHMENT_BYTES:
        invalid({"file": "Документ після обробки перевищує ліміт. Зменште розмір зображення."})
    name = re.split(r"[/\\]", upload.name)[-1].rsplit(".", 1)[0]
    name = "".join(char for char in name if not unicodedata.category(char).startswith("C")).strip(" .")
    return contents, (name[:150] or "Документ") + extension, FILE_TYPES[extension]


def upload_fields(request):
    if request.content_type != "multipart/form-data":
        raise ApiError("input", "Виберіть файл для завантаження.", 415)
    try:
        length = int(request.META.get("CONTENT_LENGTH") or 0)
        if length > settings.ATTACHMENT_BYTES + 64 * 1024:
            raise ApiError("size", "Файл перевищує дозволений розмір.", 413)
        files = request.FILES.getlist("file")
        if len(files) != 1:
            invalid({"file": "Виберіть один файл."})
        fields = request.POST
    except (SuspiciousOperation, MultiPartParserError, ValueError):
        raise ApiError("input", "Некоректне або завелике завантаження.", 400) from None
    return files[0], fields


def saved_upload(record, user, attachment_id):
    existing = Attachment.objects.filter(pk=attachment_id).first()
    if existing is not None:
        if existing.achievement_id != record.pk:
            missing()
        return JsonResponse(record_data(record, user))
    return None


@require_http_methods(["POST"])
@endpoint(User.Role.STUDENT)
def upload(request, record_id):
    record = get_record(request.user, record_id)
    require_editable_evidence(record)
    file, fields = upload_fields(request)
    attachment_id = uuid_field(fields, "id")
    replace_id = uuid_field(fields, "replace_id", optional=True)
    existing = saved_upload(record, request.user, attachment_id)
    if existing:
        return existing
    try:
        revision = int(fields.get("revision", ""))
    except ValueError:
        revision = None
    check_revision(revision, record.revision)
    blocked = throttled(request, f"attachments:{request.user.pk}", 30, 600)
    if blocked:
        return blocked
    contents, filename, content_type = validated_file(file)
    try:
        with transaction.atomic():
            lock_student(request.user)
            record = get_record(request.user, record_id, lock=True)
            require_editable_evidence(record)
            existing = saved_upload(record, request.user, attachment_id)
            if existing:
                return existing
            check_revision(revision, record.revision)
            old = record.attachments.filter(pk=replace_id).first() if replace_id else None
            if replace_id and old is None:
                missing()
            if not old and record.attachments.count() >= settings.ATTACHMENT_COUNT:
                invalid({"file": f"Можна додати до {settings.ATTACHMENT_COUNT} файлів на досягнення."})
            total = Attachment.objects.filter(achievement__owner=request.user).aggregate(total=Sum("size"))["total"] or 0
            if total - (old.size if old else 0) + len(contents) > settings.ATTACHMENT_QUOTA:
                invalid({"file": "Вичерпано ліміт місця для ваших документів."})
            item = record.attachments.create(pk=attachment_id, filename=filename, size=len(contents), content_type=content_type)
            AttachmentContent.objects.create(attachment=item, data=contents)
            if old:
                event(request.user, record, "attachment_removed", old.pk)
                old.delete()
            event(request.user, record, "attachment_added", item.pk)
            update_record(record, [])
            return JsonResponse(record_data(record, request.user), status=201)
    except DatabaseError:
        raise ApiError("storage", "Документ не збережено. Повторіть завантаження.", 503) from None


@require_http_methods(["DELETE"])
@endpoint(User.Role.STUDENT)
def remove(request, record_id, attachment_id):
    data = json_body(request)
    with transaction.atomic():
        lock_student(request.user)
        record = get_record(request.user, record_id, lock=True)
        check_revision(data.get("revision"), record.revision)
        require_editable_evidence(record)
        if not record.attachments.filter(pk=attachment_id).delete()[0]:
            missing()
        event(request.user, record, "attachment_removed", attachment_id)
        update_record(record, [])
        return JsonResponse(record_data(record, request.user))


@require_GET
@endpoint()
def download(request, record_id, attachment_id):
    record = get_record(request.user, record_id)
    item = AttachmentContent.objects.select_related("attachment").filter(
        pk=attachment_id, attachment__achievement=record,
    ).first()
    if item is None:
        missing()
    response = FileResponse(io.BytesIO(item.data), filename=item.attachment.filename, as_attachment=True,
                            content_type=item.attachment.content_type)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "sandbox; default-src 'none'"
    return response

import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import DecimalValidator, URLValidator
from django.db import IntegrityError, transaction
from django.db.models import Exists, OuterRef, Prefetch
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .api import ApiError, endpoint, invalid, json_body, text_field, user_data, user_role
from .models import (
    AcademicProfile, Achievement, AchievementEvent, AchievementShare, Attachment,
    Competition, CompetitionCategory, CompetitionCycle, CompetitionStage, Membership, StudyGroup, User,
)

PROFILE_TEXT = {"school": 160, "grade": 40, "locality": 100, "about": 800, "goals": 800, "skills": 500}
RESULT_TEXT = {
    "competition_proposal": 160, "season_proposal": 40, "stage_proposal": 120,
    "section": 120, "topic": 200, "school": 160, "grade": 40, "declared_team": 120,
    "declared_members": 500, "award": 120, "placement": 80, "description": 1200,
}
SAFE_URL = URLValidator(schemes=["https", "http"])
REVISION_MESSAGE = "Запис уже змінено. Відкрийте актуальну версію, перш ніж зберігати."
Status = Achievement.Status


def missing():
    raise ApiError("missing", "Запис не знайдено або доступу до нього немає.", 404)


def lock_student(user):
    return User.objects.select_for_update().get(pk=user.pk)


def check_revision(expected, actual):
    if type(expected) is not int or expected != actual:
        raise ApiError("conflict", REVISION_MESSAGE, 409)


def safe_url(data, field, maximum=500):
    value = text_field(data, field, 0, maximum)
    if not value:
        return ""
    try:
        SAFE_URL(value)
        if urlsplit(value).username is not None or "\\" in value or any(char.isspace() for char in value):
            raise ValidationError("URL")
    except (ValidationError, ValueError):
        invalid({field: "Введіть повну адресу з https:// або http:// без даних входу."})
    return value


def strings(data, field, count, maximum, *, urls=False):
    values = data.get(field, [])
    if not isinstance(values, list) or len(values) > count:
        invalid({field: f"Можна додати до {count} значень."})
    clean = (safe_url if urls else lambda data, field, limit: text_field(data, field, 0, limit))
    return list(dict.fromkeys(value for raw in values if (value := clean({field: raw}, field, maximum))))


def profile_data(user, profile):
    return {"id": user.pk, "full_name": user.full_name, **{field: getattr(profile, field) for field in PROFILE_TEXT},
            "interests": profile.interests, "links": profile.links, "revision": profile.revision}


@require_http_methods(["GET", "PATCH", "POST"])
@endpoint(User.Role.STUDENT)
def my_profile(request):
    if request.method == "GET":
        user = User.objects.select_related("academic_profile").get(pk=request.user.pk)
        return JsonResponse(profile_data(user, getattr(user, "academic_profile", None) or AcademicProfile()))
    data = json_body(request)
    with transaction.atomic():
        user = lock_student(request.user)
        profile, _ = AcademicProfile.objects.get_or_create(student=user)
        if request.method == "POST" or "full_name" in data:
            user.full_name = text_field(data, "full_name", 1, 120)
        if request.method == "PATCH":
            check_revision(data.get("revision"), profile.revision)
            for field, maximum in PROFILE_TEXT.items():
                if field in data:
                    setattr(profile, field, text_field(data, field, 0, maximum))
            if "interests" in data:
                profile.interests = strings(data, "interests", 12, 60)
            if "links" in data:
                profile.links = strings(data, "links", 5, 500, urls=True)
        profile.revision += 1
        profile.save()
        user.save(update_fields=["full_name"])
    return JsonResponse({**profile_data(user, profile), "user": user_data(user)})


def teacher_memberships(user):
    return Membership.objects.filter(group__owner=user, group__archived=False, status=Membership.Status.APPROVED)


@require_GET
@endpoint(User.Role.TEACHER)
def student_profile(request, student_id):
    student = User.objects.filter(
        id=student_id, role=User.Role.STUDENT,
        id__in=teacher_memberships(request.user).values("student_id"),
    ).select_related("academic_profile").first()
    if student is None:
        missing()
    return JsonResponse(profile_data(student, getattr(student, "academic_profile", None) or AcademicProfile()))


def portfolio_user(user):
    if not user.is_authenticated:
        raise ApiError("session", "Увійдіть, щоб продовжити.", 401)
    role = user_role(user)
    if role not in (User.Role.STUDENT, User.Role.TEACHER):
        raise ApiError("forbidden", "Ця дія недоступна для вашої ролі.", 403)
    return role


@require_GET
@endpoint()
def catalogue(request):
    portfolio_user(request.user)
    categories = CompetitionCategory.objects.order_by("id").prefetch_related(
        Prefetch("competitions", Competition.objects.order_by("name")),
        Prefetch("competitions__cycles", CompetitionCycle.objects.order_by("-season")),
        Prefetch("competitions__cycles__stages", CompetitionStage.objects.order_by("name")),
    )
    return JsonResponse({"upload_limits": {"max_bytes": settings.ATTACHMENT_BYTES, "count": settings.ATTACHMENT_COUNT}, "categories": [{
        "id": category.pk, "name": category.name, "competitions": [{
            "id": competition.pk, "name": competition.name, "asks_topic": competition.asks_topic,
            "team_by_default": competition.team_by_default, "cycles": [{
                "id": cycle.pk, "season": cycle.season, "starts_on": cycle.starts_on, "ends_on": cycle.ends_on,
                "stages": [{"id": stage.pk, "name": stage.name} for stage in cycle.stages.all()],
            } for cycle in competition.cycles.all()],
        } for competition in category.competitions.all()],
    } for category in categories]})


def visible_achievements(user):
    if portfolio_user(user) == User.Role.STUDENT:
        return Achievement.objects.filter(owner=user)
    return Achievement.objects.exclude(status=Status.DRAFT).filter(
        owner__role=User.Role.STUDENT,
    ).filter(Exists(AchievementShare.objects.filter(
        achievement_id=OuterRef("pk"), membership__student_id=OuterRef("owner_id"),
        membership__in=teacher_memberships(user),
    )))


def get_record(user, record_id, *, lock=False):
    queryset = visible_achievements(user)
    record = (queryset.select_for_update() if lock else queryset).filter(pk=record_id).first()
    if record is None:
        missing()
    return record


def attachment_data(item):
    return {"id": item.pk, "filename": item.filename, "content_type": item.content_type, "size": item.size}


def summary(record):
    return {
        "id": record.pk, "student": {"id": record.owner_id, "full_name": record.owner.full_name},
        "competition_name": str(record.competition) if record.competition_id else record.competition_proposal,
        "competition_id": record.competition_id, "season": record.cycle.season if record.cycle_id else record.season_proposal,
        "stage_name": record.stage.name if record.stage_id else record.stage_proposal,
        "academic_year": record.academic_year, "status": record.status, "evidence": record.evidence,
        "has_document": record.has_document if hasattr(record, "has_document") else record.attachments.exists(),
        "has_link": bool(record.results_url),
        "result_kind": record.result_kind, "participation": record.participation,
        "updated_at": record.updated_at,
    }


def record_data(record, viewer):
    value = {**summary(record), **{field: getattr(record, field) for field in RESULT_TEXT},
             "cycle_id": record.cycle_id, "stage_id": record.stage_id, "revision": record.revision,
             "starts_on": record.starts_on, "ends_on": record.ends_on,
             "score": str(record.score) if record.score is not None else None, "results_url": record.results_url,
             "team": {"id": record.team_id, "name": record.team.name, "result": record.team.result} if record.team_id else None,
             "attachments": [attachment_data(item) for item in record.attachments.order_by("created_at", "id")]}
    if viewer.pk == record.owner_id:
        value["group_ids"] = list(record.shares.filter(
            membership__status=Membership.Status.APPROVED, membership__group__archived=False,
        ).order_by("membership__group_id").values_list("membership__group_id", flat=True))
        value["duplicate"] = possible_duplicate(record)
    return value


def event(user, record, action, attachment_id=None):
    AchievementEvent.objects.create(actor=user, achievement_id=record.pk, action=action, attachment_id=attachment_id)


def update_record(record, fields=None):
    record.revision += 1
    record.save(update_fields=[*fields, "revision", "updated_at"] if fields is not None else None)


def uuid_field(data, field, *, optional=False):
    value = data.get(field)
    if optional and not value:
        return None
    try:
        parsed = uuid.UUID(value) if isinstance(value, str) else None
    except ValueError:
        parsed = None
    if parsed is None or parsed.version != 4:
        invalid({field: "Некоректний ідентифікатор. Оновіть сторінку."})
    return parsed


def pick(data, field, choices):
    value = data.get(field)
    if value not in choices:
        invalid({field: "Виберіть одне з доступних значень."})
    return value


def reference(data, field, queryset):
    value = data.get(field)
    if value is None:
        return None
    item = queryset.filter(pk=value).first() if type(value) is int and 0 < value < 2**53 else None
    if item is None:
        invalid({field: "Виберіть запис із відповідного довідника."})
    return item


def event_date(data, field):
    if data.get(field) is None:
        return None
    value = text_field(data, field, 0, 10)
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        invalid({field: "Вкажіть коректну дату."})


def result_score(data):
    value = text_field(data, "score", 0, 24) if data.get("score") is not None else ""
    if not value:
        return None
    try:
        score = Decimal(value.replace(",", "."))
        DecimalValidator(max_digits=12, decimal_places=4)(score)
        return score.quantize(Decimal("0.0001"))
    except (InvalidOperation, ValidationError):
        invalid({"score": "Вкажіть число з не більш як 8 цифрами до коми і 4 після."})


def result_fields(record, data):
    for field, maximum in RESULT_TEXT.items():
        setattr(record, field, text_field(data, field, 0, maximum))
    record.competition = reference(data, "competition_id", Competition.objects.all())
    record.cycle = reference(data, "cycle_id", CompetitionCycle.objects.filter(competition=record.competition))
    record.stage = reference(data, "stage_id", CompetitionStage.objects.filter(cycle=record.cycle))
    for selected, proposed in [("competition", "competition_proposal"), ("cycle", "season_proposal"), ("stage", "stage_proposal")]:
        if getattr(record, f"{selected}_id"):
            setattr(record, proposed, "")
    record.starts_on = event_date(data, "starts_on")
    record.ends_on = event_date(data, "ends_on")
    if record.ends_on and (not record.starts_on or record.ends_on < record.starts_on):
        invalid({"ends_on": "Дата завершення має бути не раніше дати початку."})
    year = data.get("academic_year")
    if year is not None and (type(year) is not int or not 2000 <= year <= 2099):
        invalid({"academic_year": "Вкажіть рік від 2000 до 2099."})
    record.academic_year = year
    record.participation = pick(data, "participation", Achievement.Participation.values)
    if record.participation == Achievement.Participation.SOLO:
        record.declared_team = record.declared_members = ""
    record.result_kind = pick(data, "result_kind", Achievement.Result.values)
    record.score = result_score(data)
    evidence_fields(record, data)


def evidence_fields(record, data):
    record.results_url = safe_url(data, "results_url")
    record.evidence = pick(data, "evidence", Achievement.Evidence.values)


def duplicate_key(record):
    result = record.shared_result()
    # Match labels too, so a proposal still matches after its catalogue entry is added.
    return tuple(" ".join(result[field].casefold().split()) for field in ("competition", "season", "stage", "section")) + (
        record.participation,
    )


def possible_duplicate(record):
    key = duplicate_key(record)
    if not key[0] or not key[1]:
        return False
    others = Achievement.objects.filter(owner_id=record.owner_id, participation=record.participation).exclude(
        pk=record.pk,
    ).select_related("competition", "cycle", "stage")
    return any(duplicate_key(other) == key for other in others)


@require_http_methods(["GET", "POST"])
@endpoint()
def achievements(request):
    if request.method == "GET":
        records = visible_achievements(request.user).select_related("owner", "competition", "cycle", "stage").annotate(
            has_document=Exists(Attachment.objects.filter(achievement_id=OuterRef("pk"))),
        ).order_by("-updated_at", "id")
        return JsonResponse({"records": [summary(item) for item in records]})
    if portfolio_user(request.user) != User.Role.STUDENT:
        raise ApiError("forbidden", "Створювати досягнення може учень.", 403)
    data = json_body(request)
    record_id = uuid_field(data, "id")
    with transaction.atomic():
        lock_student(request.user)
        record = Achievement.objects.filter(pk=record_id).first()
        if record:
            if record.owner_id != request.user.pk:
                missing()
            return JsonResponse(record_data(record, request.user))
        if AchievementEvent.objects.filter(achievement_id=record_id, action="deleted").exists():
            raise ApiError("conflict", "Цю чернетку вже видалено.", 409)
        profile = AcademicProfile.objects.filter(student=request.user).first() or AcademicProfile()
        record = Achievement(id=record_id, owner=request.user)
        result_fields(record, {"school": profile.school, "grade": profile.grade, **data})
        try:
            with transaction.atomic():
                record.save(force_insert=True)
        except IntegrityError:
            if Achievement.objects.filter(pk=record_id).exists():
                missing()
            raise
        save_draft_groups(request.user, record, data)
        event(request.user, record, "created")
        return JsonResponse(record_data(record, request.user), status=201)


@require_http_methods(["GET", "PATCH", "DELETE"])
@endpoint()
def achievement(request, record_id):
    if request.method == "GET":
        return JsonResponse(record_data(get_record(request.user, record_id), request.user))
    if portfolio_user(request.user) != User.Role.STUDENT:
        raise ApiError("forbidden", "Ця дія доступна власнику запису.", 403)
    data = json_body(request)
    with transaction.atomic():
        lock_student(request.user)
        record = get_record(request.user, record_id, lock=True)
        check_revision(data.get("revision"), record.revision)
        if record.status != Status.DRAFT:
            raise ApiError("conflict", "Відкличте неперевірений запис, щоб змінити результат.", 409)
        if request.method == "DELETE":
            for attachment_id in record.attachments.values_list("id", flat=True):
                event(request.user, record, "attachment_removed", attachment_id)
            event(request.user, record, "deleted")
            record.delete()
            return JsonResponse({"deleted": True})
        result_fields(record, data)
        save_draft_groups(request.user, record, data)
        update_record(record)
        return JsonResponse(record_data(record, request.user))


def recipients(user, data, *, required=True):
    ids = data.get("group_ids")
    if not isinstance(ids, list) or (required and not ids) or any(type(value) is not int or not 0 < value < 2**53 for value in ids):
        invalid({"group_ids": "Оберіть хоча б одну підтверджену групу."})
    groups = list(StudyGroup.objects.select_for_update().filter(pk__in=ids, archived=False).order_by("pk"))
    members = list(Membership.objects.filter(student=user, group__in=groups, status=Membership.Status.APPROVED))
    if len(members) != len(set(ids)):
        invalid({"group_ids": "Одержувачі змінилися. Оновіть список підтверджених груп."})
    return members


def save_draft_groups(user, record, data):
    if "group_ids" in data:
        members = recipients(user, data, required=False)
        record.shares.all().delete()
        AchievementShare.objects.bulk_create([AchievementShare(achievement=record, membership=item) for item in members])


@require_POST
@endpoint(User.Role.STUDENT)
def submit(request, record_id):
    data = json_body(request)
    with transaction.atomic():
        record = get_record(request.user, record_id, lock=True)
        if (record.status == Status.SUBMITTED and data.get("revision") == record.revision - 1
                and data.get("group_ids") == list(record.shares.order_by("membership__group_id").values_list("membership__group_id", flat=True))):
            return JsonResponse(record_data(record, request.user))
        check_revision(data.get("revision"), record.revision)
        if record.status != Status.DRAFT:
            raise ApiError("conflict", "Подати можна лише чернетку.", 409)
        fields = {}
        if not record.competition_id and not record.competition_proposal:
            fields["competition_id"] = "Виберіть конкурс або введіть запропоновану назву."
        if not record.cycle_id and not record.season_proposal:
            fields["cycle_id"] = "Виберіть цикл або зазначте сезон."
        if record.participation == Achievement.Participation.TEAM and not record.declared_team:
            fields["declared_team"] = "Введіть назву команди."
        if record.evidence == Achievement.Evidence.LINK and not record.results_url:
            fields["results_url"] = "Додайте посилання на результати або змініть стан матеріалів."
        if fields:
            invalid(fields)
        if possible_duplicate(record) and data.get("allow_duplicate") is not True:
            raise ApiError("duplicate", "У вас уже є схожий запис. Підтвердьте, якщо це окремий результат.", 409)
        members = recipients(request.user, data)
        record.shares.all().delete()
        AchievementShare.objects.bulk_create([AchievementShare(achievement=record, membership=item) for item in members])
        record.status = Status.SUBMITTED
        update_record(record, ["status"])
        event(request.user, record, "submitted")
        return JsonResponse(record_data(record, request.user))


@require_POST
@endpoint(User.Role.STUDENT)
def withdraw(request, record_id):
    data = json_body(request)
    with transaction.atomic():
        record = get_record(request.user, record_id, lock=True)
        check_revision(data.get("revision"), record.revision)
        if record.status != Status.SUBMITTED:
            raise ApiError("conflict", "Відкликати можна лише неперевірений запис.", 409)
        record.shares.all().delete()
        record.team = None
        record.status = Status.DRAFT
        update_record(record, ["status", "team"])
        event(request.user, record, "withdrawn")
        return JsonResponse(record_data(record, request.user))


def require_editable_evidence(record):
    if record.status not in (Status.DRAFT, Status.SUBMITTED):
        raise ApiError("conflict", "Матеріали цього запису більше не можна змінити.", 409)


@require_http_methods(["PATCH"])
@endpoint(User.Role.STUDENT)
def evidence(request, record_id):
    data = json_body(request)
    with transaction.atomic():
        record = get_record(request.user, record_id, lock=True)
        check_revision(data.get("revision"), record.revision)
        require_editable_evidence(record)
        evidence_fields(record, data)
        if record.evidence == Achievement.Evidence.LINK and not record.results_url:
            invalid({"results_url": "Додайте посилання на результати або змініть стан матеріалів."})
        update_record(record, ["evidence", "results_url"])
        event(request.user, record, "evidence_changed")
        return JsonResponse(record_data(record, request.user))

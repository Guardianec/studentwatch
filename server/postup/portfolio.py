import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import DecimalValidator, URLValidator
from django.db import IntegrityError, transaction
from django.db.models import Exists, Max, OuterRef, Prefetch
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .api import ApiError, endpoint, invalid, json_body, text_field, user_data, user_role
from .models import (
    AcademicProfile, Achievement, AchievementEvent, AchievementShare,
    Competition, CompetitionCategory, CompetitionCycle, CompetitionStage, Membership, StudyGroup, User,
)

PROFILE_TEXT = {"school": 160, "grade": 40, "locality": 100, "about": 800, "goals": 800, "skills": 500}
RESULT_TEXT = {
    "competition_proposal": 160, "season_proposal": 40, "stage_proposal": 120,
    "section": 120, "topic": 200, "school": 160, "grade": 40, "declared_team": 120,
    "declared_members": 500, "award": 120, "placement": 80, "description": 1200,
}
RESULT_FIELDS = (*RESULT_TEXT, "competition_id", "cycle_id", "stage_id", "starts_on", "ends_on",
                 "academic_year", "participation", "result_kind", "score")
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
    return Achievement.objects.filter(status=Status.SUBMITTED).filter(
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
    return {"id": item.pk, "filename": item.filename, "content_type": item.content_type, "size": item.size,
            "added_revision": item.added_revision}


def active_shares(record):
    return record.shares.filter(membership__student_id=record.owner_id, membership__status=Membership.Status.APPROVED,
                                membership__group__archived=False)


def shares_for(record, viewer):
    shares = active_shares(record)
    if viewer.pk != record.owner_id:
        shares = shares.filter(membership__group__owner=viewer)
    return shares.select_related("membership__group", "decision__actor").order_by("membership__group_id")


def share_data(share, *, detail=False, viewer=None):
    record = share.achievement
    latest = getattr(record, "latest_attachment", None)
    if not hasattr(record, "latest_attachment"):
        latest = record.attachments.aggregate(latest=Max("added_revision"))["latest"]
    value = {"group_id": share.membership.group_id, "group": share.membership.group.name, "status": share.status,
             "revision": share.revision, "submitted_at": share.submitted_at, "seen_materials": share.seen_materials,
             "new_materials": max(latest or 0, record.link_revision) > share.seen_materials}
    if detail:
        value["decision"] = event_data(share.decision) if share.decision else None
        value["can_revoke"] = share.status == Status.VERIFIED and share.decision_id is not None and share.decision.actor_id == viewer.pk
    return value


def summary(record):
    contest = record.shared_result()
    return {
        "id": record.pk, "student": {"id": record.owner_id, "full_name": record.owner.full_name},
        "competition_name": contest["competition"], "competition_id": record.competition_id, "season": contest["season"],
        "stage_name": contest["stage"], "category_id": record.competition.category_id if record.competition_id else None,
        "academic_year": record.academic_year, "status": record.status, "evidence": record.evidence,
        "has_document": record.has_document if hasattr(record, "has_document") else record.attachments.exists(),
        "has_link": bool(record.results_url),
        "result_kind": record.result_kind, "participation": record.participation,
        "updated_at": record.updated_at, "version": record.version,
        "resubmitted": record.submission_count > 1,
        "result_label": record.award or record.placement or record.get_result_kind_display(),
    }


def result_values(record):
    return {field: getattr(record, field) for field in RESULT_FIELDS} | {
        "starts_on": record.starts_on.isoformat() if record.starts_on else None,
        "ends_on": record.ends_on.isoformat() if record.ends_on else None,
        "score": str(record.score) if record.score is not None else None,
    }


def record_data(record, viewer):
    shares = list(shares_for(record, viewer))
    attachments = list(record.attachments.order_by("created_at", "id"))
    record.latest_attachment = max((item.added_revision for item in attachments), default=0)
    value = {**summary(record), **result_values(record),
             "results_url": record.results_url, "materials_revision": record.materials_revision,
             "reviews": [share_data(item, detail=True, viewer=viewer) for item in shares if item.submitted_at],
             "team": {"id": record.team_id, "name": record.team.name, "result": record.team.result} if record.team_id else None,
             "attachments": [attachment_data(item) for item in attachments]}
    if viewer.pk == record.owner_id:
        value["revision"] = record.revision
        value["group_ids"] = [item.membership.group_id for item in shares]
        value["changes_draft"] = record.changes_draft
        value["can_withdraw"] = record.status == Status.SUBMITTED and not any(
            item.status != Status.SUBMITTED or item.decision_id for item in shares
        )
        value["duplicate"] = possible_duplicate(record)
    return value


def event(user, record, action, attachment_id=None, *, group_id=None, details=None, request_id=None):
    return AchievementEvent.objects.create(actor=user, achievement_id=record.pk, action=action, attachment_id=attachment_id,
                                           version=record.version, group_id=group_id, details=details or {}, request_id=request_id)


def event_data(item):
    details = {key: value for key, value in item.details.items() if key != "input_revision"}
    return {"id": item.pk, "actor": item.actor.full_name if item.actor else "", "version": item.version,
            "action": item.action, "group_id": item.group_id, "at": item.created_at, "details": details}


def history_values(record):
    # Use labels for catalogue references so history survives catalogue renames.
    labels = {"competition_name": "competition", "season": "season", "stage_name": "stage"}
    result = result_values(record)
    for field in ("competition_id", "cycle_id", "stage_id", "competition_proposal", "season_proposal", "stage_proposal"):
        result.pop(field)
    shared = record.shared_result()
    return result | {field: shared[key] for field, key in labels.items()}


def differences(before, after):
    old, new = history_values(before), history_values(after)
    return {key: [old[key], value] for key, value in new.items() if old[key] != value}


def reset_reviews(record, actor, *, attachment_id=None, previous_url=None, all_groups=False):
    decisions = record.shares.filter(submitted_at__isnull=False).select_related("decision", "membership")
    for share in decisions:
        basis = share.decision.details if share.decision else {}
        invalidated = (attachment_id is not None and str(attachment_id) in basis.get("attachments", [])) or (
            previous_url is not None and basis.get("url") == previous_url
        )
        if all_groups or (share.status == Status.VERIFIED and invalidated):
            needs_notice = all_groups and share.status == Status.VERIFIED
            share.status = Status.SUBMITTED
            share.revision += 1
            share.decision = None
            share.save(update_fields=["status", "revision", "decision"])
            if needs_notice:
                event(actor, record, "team_review_reset", group_id=share.membership.group_id)
            elif not all_groups:
                event(actor, record, "basis_removed", group_id=share.membership.group_id)


def update_record(record, fields=None, *, private=False):
    record.revision += 1
    if private:
        record.save(update_fields=[*fields, "revision"])
    else:
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
        from .review import portfolio_list
        return portfolio_list(request)
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
        evidence_fields(record, data)
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
        if request.method == "DELETE":
            if record.status != Status.DRAFT:
                raise ApiError("conflict", "Видалити можна лише чернетку.", 409)
            for item in record.attachments.all():
                event(request.user, record, "attachment_removed", item.pk, details={"filename": item.filename})
            event(request.user, record, "deleted")
            record.delete()
            return JsonResponse({"deleted": True})
        if record.status == Status.DRAFT:
            before = history_values(record)
            result_fields(record, data)
            evidence_fields(record, data)
            save_draft_groups(request.user, record, data)
            update_record(record)
            diff = {key: [before[key], value] for key, value in history_values(record).items() if before[key] != value}
            if diff:
                event(request.user, record, "draft_edited", details={"changes": diff})
        else:
            draft = Achievement()
            result_fields(draft, data)
            record.changes_draft = result_values(draft) | {"reply": text_field(data, "reply", 0, 600)}
            update_record(record, ["changes_draft"], private=True)
        return JsonResponse(record_data(record, request.user))


@require_http_methods(["DELETE"])
@endpoint(User.Role.STUDENT)
def discard_changes(request, record_id):
    with transaction.atomic():
        record = get_record(request.user, record_id, lock=True)
        check_revision(json_body(request).get("revision"), record.revision)
        if record.changes_draft is not None:
            record.changes_draft = None
            update_record(record, ["changes_draft"], private=True)
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
    request_id = uuid_field(data, "request_id", optional=True)
    with transaction.atomic():
        record = get_record(request.user, record_id, lock=True)
        if request_id:
            previous = AchievementEvent.objects.filter(request_id=request_id).first()
            if previous:
                if previous.achievement_id == record.pk and previous.actor_id == request.user.pk and previous.action in ("submitted", "resubmitted"):
                    return JsonResponse(record_data(record, request.user))
                raise ApiError("conflict", REVISION_MESSAGE, 409)
        elif (record.status == Status.SUBMITTED and not record.changes_draft and data.get("revision") == record.revision - 1
              and data.get("group_ids") == list(active_shares(record).order_by("membership__group_id").values_list("membership__group_id", flat=True))
              and AchievementEvent.objects.filter(achievement_id=record.pk, version=record.version,
                action__in=("submitted", "resubmitted"), details__input_revision=data.get("revision")).exists()):
            return JsonResponse(record_data(record, request.user))
        check_revision(data.get("revision"), record.revision)
        resubmitting = record.status != Status.DRAFT
        if resubmitting and record.changes_draft is None:
            raise ApiError("conflict", "Збережіть чернетку змін перед повторним поданням.", 409)
        candidate = Achievement(id=record.pk, owner_id=record.owner_id) if resubmitting else record
        if resubmitting:
            result_fields(candidate, record.changes_draft)
        fields = {}
        if not candidate.competition_id and not candidate.competition_proposal:
            fields["competition_id"] = "Виберіть конкурс або введіть запропоновану назву."
        if not candidate.cycle_id and not candidate.season_proposal:
            fields["cycle_id"] = "Виберіть цикл або зазначте сезон."
        if candidate.participation == Achievement.Participation.TEAM and not candidate.declared_team:
            fields["declared_team"] = "Введіть назву команди."
        if record.evidence == Achievement.Evidence.LINK and not record.results_url:
            fields["results_url"] = "Додайте посилання на результати або змініть стан матеріалів."
        if fields:
            invalid(fields)
        if possible_duplicate(candidate) and data.get("allow_duplicate") is not True:
            raise ApiError("duplicate", "У вас уже є схожий запис. Підтвердьте, якщо це окремий результат.", 409)
        members = recipients(request.user, data)
        current = {share.membership_id: share for share in record.shares.select_related("membership").order_by("pk")}
        selected = {member.pk: member for member in members}
        diff = differences(record, candidate) if resubmitting else {}
        reply = record.changes_draft.get("reply", "") if resubmitting else ""
        if resubmitting:
            if record.team_id and (record.team_context() != candidate.team_context() or candidate.participation != record.participation):
                record.team = None
            result_fields(record, record.changes_draft)
        record.changes_draft = None
        record.version += 1
        record.submission_count += 1
        record.status = Status.SUBMITTED
        update_record(record)
        now = timezone.now()
        for member_id, share in current.items():
            if member_id not in selected:
                if share.submitted_at:
                    event(request.user, record, "access_revoked", group_id=share.membership.group_id)
                share.delete()
        for member_id, member in selected.items():
            share = current.get(member_id)
            if share and share.submitted_at:
                share.status, share.decision, share.submitted_at = Status.SUBMITTED, None, now
                share.revision += 1
                share.save(update_fields=["status", "decision", "submitted_at", "revision"])
            else:
                if share:
                    share.delete()
                AchievementShare.objects.create(achievement=record, membership=member, first_version=record.version, submitted_at=now)
                event(request.user, record, "access_granted", group_id=member.group_id)
        try:
            with transaction.atomic():
                event(request.user, record, "resubmitted" if record.submission_count > 1 else "submitted", request_id=request_id,
                      details={"changes": diff, "reply": reply, "input_revision": data.get("revision")})
        except IntegrityError:
            raise ApiError("conflict", REVISION_MESSAGE, 409) from None
        return JsonResponse(record_data(record, request.user))


@require_POST
@endpoint(User.Role.STUDENT)
def withdraw(request, record_id):
    data = json_body(request)
    with transaction.atomic():
        record = get_record(request.user, record_id, lock=True)
        check_revision(data.get("revision"), record.revision)
        if record.status != Status.SUBMITTED or active_shares(record).exclude(status=Status.SUBMITTED, decision__isnull=True).exists():
            raise ApiError("conflict", "Відкликати можна лише неперевірений запис.", 409)
        for share in record.shares.filter(submitted_at__isnull=False).select_related("membership"):
            event(request.user, record, "access_revoked", group_id=share.membership.group_id)
        record.shares.all().delete()
        record.team = None
        record.changes_draft = None
        record.status = Status.DRAFT
        update_record(record, ["status", "team", "changes_draft"])
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
        before = record.results_url
        previous_evidence = record.evidence
        evidence_fields(record, data)
        if record.evidence == Achievement.Evidence.LINK and not record.results_url:
            invalid({"results_url": "Додайте посилання на результати або змініть стан матеріалів."})
        if before != record.results_url:
            record.materials_revision += 1
            record.link_revision = record.materials_revision if record.results_url else 0
            if before:
                reset_reviews(record, request.user, previous_url=before)
        update_record(record, ["evidence", "results_url", "materials_revision", "link_revision"])
        if previous_evidence != record.evidence or before != record.results_url:
            details = {"link_changed": before != record.results_url}
            if previous_evidence != record.evidence:
                details["changes"] = {"evidence": [previous_evidence, record.evidence]}
            event(request.user, record, "evidence_changed", details=details)
        return JsonResponse(record_data(record, request.user))

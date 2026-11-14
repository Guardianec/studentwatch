from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, F, OuterRef, Prefetch, Q, Subquery
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .api import ApiError, endpoint, invalid, json_body, text_field
from .models import Achievement, AchievementEvent, AchievementShare, Attachment, Membership, StudyGroup, User
from .portfolio import (
    REVISION_MESSAGE, Status, check_revision, event, event_data, get_record, missing, pick, portfolio_user,
    record_data, share_data, shares_for, summary, teacher_memberships, uuid_field, visible_achievements,
)

PAGE_SIZE = 20
DECISIONS = ("verified", "clarify", "rejected", "confirmation_revoked")
BASES = ("document", "protocol", "known", "other")


def conflict():
    raise ApiError("conflict", REVISION_MESSAGE, 409)


def positive(value, *, maximum=2**53 - 1):
    if not value:
        return None
    if not value.isascii() or not value.isdecimal() or len(value) > 16 or not 1 <= int(value) <= maximum:
        invalid({"filter": "Некоректний фільтр."})
    return int(value)


def filters(request, records, *, search_student):
    params = request.GET
    for param, field in {"year": "academic_year", "category": "competition__category_id", "student": "owner_id"}.items():
        value = positive(params.get(param))
        if value:
            records = records.filter(**{field: value})
    for param, lookup, proposal, foreign_key in (
        ("competition", "competition__name", "competition_proposal", "competition_id"),
        ("stage", "stage__name", "stage_proposal", "stage_id"),
    ):
        value = params.get(param, "").replace("\x00", "")[:160]
        if value:
            records = records.filter(Q(**{lookup: value}) | Q(**{proposal: value, f"{foreign_key}__isnull": True}))
    participation = params.get("participation")
    if participation in Achievement.Participation.values:
        records = records.filter(participation=participation)
    for term in params.get("search", "").replace("\x00", "")[:120].split()[:8]:
        variants = {term, term.lower(), term.upper(), term.capitalize()}
        matching = Q()
        for spelling in sorted(variants):
            matching |= Q(competition__name__icontains=spelling) | Q(competition_proposal__icontains=spelling)
            if search_student:
                matching |= Q(owner__full_name__icontains=spelling)
        records = records.filter(matching)
    doc = params.get("document")
    if doc == "present":
        records = records.filter(has_document=True)
    elif doc == "absent":
        records = records.filter(has_document=False)
    elif doc == "waiting":
        records = records.filter(has_document=False, evidence=Achievement.Evidence.LATER)
    return records


def matching_shares(user, group=None):
    shares = AchievementShare.objects.filter(
        submitted_at__isnull=False, membership__student_id=F("achievement__owner_id"),
        membership__status=Membership.Status.APPROVED, membership__group__archived=False,
    )
    if portfolio_user(user) == User.Role.TEACHER:
        shares = shares.filter(membership__in=teacher_memberships(user))
    if group:
        shares = shares.filter(membership__group_id=group)
    return shares


def status_filter(shares, status):
    if status == "action":
        return shares.filter(Q(status=Status.SUBMITTED) | Q(achievement__link_revision__gt=F("seen_materials"))
                             | Exists(Attachment.objects.filter(achievement_id=OuterRef("achievement_id"),
                                                                added_revision__gt=OuterRef("seen_materials"))))
    if status in (Status.SUBMITTED, Status.VERIFIED, Status.REJECTED, Status.CLARIFY):
        return shares.filter(status=status)
    return shares


def pagination(total, requested):
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(requested, pages)
    start = (page - 1) * PAGE_SIZE
    return {"total": total, "page": page, "pages": pages}, slice(start, start + PAGE_SIZE)


def portfolio_list(request, *, queue=False):
    role = portfolio_user(request.user)
    group = positive(request.GET.get("group"))
    requested = positive(request.GET.get("page")) or 1
    status = request.GET.get("status") or ("action" if queue else "")
    attachments = Attachment.objects.filter(achievement_id=OuterRef("pk"))
    visible = visible_achievements(request.user).annotate(has_document=Exists(attachments),
        latest_attachment=Subquery(attachments.order_by("-added_revision").values("added_revision")[:1]))
    records = filters(request, visible, search_student=queue)
    shares = matching_shares(request.user, group)
    scoped = status_filter(shares, status)
    if queue:
        items = scoped.filter(achievement__in=records).select_related(
            "membership__group", "achievement__owner", "achievement__competition", "achievement__cycle", "achievement__stage",
        ).annotate(
            has_document=Exists(Attachment.objects.filter(achievement_id=OuterRef("achievement_id"))),
            latest_attachment=Subquery(Attachment.objects.filter(achievement_id=OuterRef("achievement_id"))
                                       .order_by("-added_revision").values("added_revision")[:1]),
        )
        ordering = ("-submitted_at", "pk") if status != "action" else ("submitted_at", "pk")
        page, window = pagination(items.count(), requested)
        rows = []
        for share in items.order_by(*ordering)[window]:
            record = share.achievement
            record.has_document = share.has_document
            record.latest_attachment = share.latest_attachment
            rows.append(summary(record) | {"review": share_data(share)})
        return JsonResponse({"records": rows, **page})

    if status == Status.DRAFT:
        records = records.filter(status=Status.DRAFT) if role == User.Role.STUDENT and not group else records.none()
    elif group or status in (*Status.values, "action"):
        records = records.filter(status=Status.SUBMITTED, pk__in=scoped.values("achievement_id"))
    totals = records.aggregate(unique=Count("pk"), categories=Count("competition__category_id", distinct=True))
    totals["verified"] = records.filter(Exists(shares.filter(achievement_id=OuterRef("pk"), status=Status.VERIFIED))).count()
    if "page" in request.GET:
        page, window = pagination(totals["unique"], requested)
    else:
        # Keep the v0.3.0 list contract for existing Windows installations.
        page, window = {}, slice(None)
    filtered = records.select_related("owner", "competition", "cycle", "stage").prefetch_related(Prefetch(
        "shares", shares.select_related("membership__group").order_by("membership__group_id"), to_attr="review_rows",
    )).order_by(F("starts_on").desc(nulls_last=True), "-created_at", "id")
    rows = []
    for record in filtered[window]:
        for share in record.review_rows:
            share.achievement = record
        rows.append(summary(record) | {"reviews": [share_data(item) for item in record.review_rows],
                                       "has_changes_draft": role == User.Role.STUDENT and record.changes_draft is not None})
    return JsonResponse({"records": rows, "counts": totals, **page})


@require_GET
@endpoint(User.Role.TEACHER)
def queue(request):
    return portfolio_list(request, queue=True)


def teacher_share(user, record, group_id):
    # Group removal and archive use the same lock before changing access.
    if not list(StudyGroup.objects.select_for_update().filter(pk=group_id, owner=user, archived=False)):
        missing()
    share = shares_for(record, user).filter(membership__group_id=group_id, submitted_at__isnull=False).first()
    if share is None:
        missing()
    return share


@require_POST
@endpoint(User.Role.TEACHER)
def decide(request, record_id, group_id):
    data = json_body(request)
    request_id = uuid_field(data, "request_id")
    action = pick(data, "action", (*DECISIONS, "materials_seen"))
    with transaction.atomic():
        record = get_record(request.user, record_id, lock=True)
        share = teacher_share(request.user, record, group_id)
        previous = AchievementEvent.objects.filter(request_id=request_id).first()
        if previous:
            if (previous.achievement_id, previous.group_id, previous.actor_id, previous.action) == (
                record.pk, group_id, request.user.pk, action,
            ):
                return JsonResponse(record_data(record, request.user))
            conflict()
        check_revision(data.get("version"), record.version)
        check_revision(data.get("share_revision"), share.revision)
        check_revision(data.get("materials_revision"), record.materials_revision)
        comment, details = "", {}
        if action == "materials_seen":
            if not share_data(share)["new_materials"]:
                conflict()
        elif action == "confirmation_revoked":
            if share.status != Status.VERIFIED or not share.decision or share.decision.actor_id != request.user.pk:
                conflict()
            comment = text_field(data, "comment", 1, 800)
        else:
            if share.status != Status.SUBMITTED:
                conflict()
            if action != "verified":
                comment = text_field(data, "comment", 1, 800)
            else:
                details = verification_basis(record, data)
                comment = text_field(data, "comment", 0 if details.get("attachments") or details.get("url") else 1, 800)
        try:
            with transaction.atomic():
                decision = event(request.user, record, action, group_id=group_id, request_id=request_id,
                                 details={"comment": comment, **details})
        except IntegrityError:
            conflict()
        if action == "materials_seen":
            share.seen_materials = record.materials_revision
        elif action == "confirmation_revoked":
            share.status = Status.SUBMITTED
            share.decision = decision
        else:
            share.status = action
            share.decision = decision
            if data.get("materials_reviewed") is True:
                share.seen_materials = record.materials_revision
        share.revision += 1
        share.save(update_fields=["status", "decision", "seen_materials", "revision"])
        return JsonResponse(record_data(record, request.user))


def verification_basis(record, data):
    basis = pick(data, "basis", BASES)
    details = {"basis": basis}
    if basis == "document":
        values = data.get("attachment_ids")
        if not isinstance(values, list) or not 1 <= len(values) <= 10:
            invalid({"attachment_ids": "Виберіть перевірений документ."})
        ids = {uuid_field({"id": value}, "id") for value in values}
        items = list(record.attachments.filter(pk__in=ids).order_by("pk"))
        if len(items) != len(ids):
            invalid({"attachment_ids": "Оновіть перелік документів і повторіть вибір."})
        details.update(attachments=[str(item.pk) for item in items], filenames=[item.filename for item in items])
    elif basis == "protocol" and data.get("use_link") is True:
        if not record.results_url:
            invalid({"basis": "Посилання вже недоступне. Опишіть підставу в коментарі."})
        details["url"] = record.results_url
    if record.participation == Achievement.Participation.TEAM:
        if record.team_id and any(record.shared_result()[key] != record.team.result[key]
                                  for key in ("kind", "award", "placement", "score")):
            raise ApiError("conflict", "Уточніть спільний результат у адміністратора перед підтвердженням.", 409)
        if data.get("team_member_confirmed") is not True:
            invalid({"team_member_confirmed": "Підтвердьте, що перевірили участь цього учня в команді."})
        details["team_member_confirmed"] = True
    return details


@require_GET
@endpoint()
def history(request, record_id):
    record = get_record(request.user, record_id)
    items = AchievementEvent.objects.filter(achievement_id=record.pk)
    group_id = positive(request.GET.get("group"))
    if request.user.pk != record.owner_id:
        allowed = Q(pk__in=[])
        shares = shares_for(record, request.user)
        if group_id:
            shares = shares.filter(membership__group_id=group_id)
            if not shares.exists():
                missing()
        for share in shares:
            allowed |= Q(group_id=share.membership.group_id, version__gte=share.first_version)
            public_fields = Q(group_id__isnull=True, version__gte=share.first_version, action__in=(
                "submitted", "resubmitted", "attachment_added", "attachment_replaced", "attachment_removed",
                "evidence_changed", "team_linked", "team_result_changed",
            ))
            allowed |= public_fields if share.first_version == 1 else public_fields & (
                Q(version__gt=share.first_version) | ~Q(action="resubmitted")
            )
        items = items.filter(allowed).exclude(action="draft_edited")
    elif group_id:
        items = items.filter(Q(group_id=group_id) | Q(group_id__isnull=True))
    groups = dict(StudyGroup.objects.filter(pk__in=items.values("group_id")).values_list("pk", "name"))
    available = {str(key) for key in record.attachments.values_list("pk", flat=True)}
    result = []
    page, window = pagination(items.count(), positive(request.GET.get("page")) or 1)
    for item in items.select_related("actor").order_by("-created_at", "-pk")[window]:
        value = event_data(item)
        value["group"] = groups.get(item.group_id, "")
        value["attachment_available"] = str(item.attachment_id) in available if item.attachment_id else None
        if "attachments" in item.details:
            value["details"]["removed_documents"] = sum(key not in available for key in item.details["attachments"])
        result.append(value)
    latest = items.filter(action__in=("resubmitted", "team_result_changed")).select_related("actor").order_by("-pk").first()
    previous = items.filter(action__in=("clarify", "rejected", "confirmation_revoked"), version__lt=latest.version
                            ).select_related("actor").order_by("-pk").first() if latest else None
    return JsonResponse({"events": result, **page, "latest": event_data(latest) if latest else None,
                         "previous": event_data(previous) if previous else None})


def notices(user):
    own = Achievement.objects.filter(owner=user)
    return AchievementEvent.objects.filter(achievement_id__in=own.values("pk"),
                                           action__in=DECISIONS + ("basis_removed", "team_review_reset"))


@require_GET
@endpoint(User.Role.STUDENT)
def notifications(request):
    items = notices(request.user)
    unseen = items.filter(read_at__isnull=True).count()
    page, window = pagination(items.count(), positive(request.GET.get("page")) or 1)
    rows = list(items.select_related("actor", "group").order_by("-created_at", "-pk")[window])
    records = {item.pk: item for item in Achievement.objects.filter(
        owner=request.user, pk__in=[item.achievement_id for item in rows],
    ).select_related("competition")}
    return JsonResponse({"unread": unseen, **page, "notifications": [
        event_data(item) | {"record_id": item.achievement_id, "read": item.read_at is not None,
                            "group": item.group.name if item.group else "",
                            "competition": str(records[item.achievement_id].competition) if records[item.achievement_id].competition_id
                            else records[item.achievement_id].competition_proposal}
        for item in rows if item.achievement_id in records
    ]})


@require_POST
@endpoint(User.Role.STUDENT)
def read_notification(request, event_id):
    items = notices(request.user).filter(pk=event_id)
    if not items.exists():
        missing()
    items.filter(read_at__isnull=True).update(read_at=timezone.now())
    return JsonResponse({"read": True})

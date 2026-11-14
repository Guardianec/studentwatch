from django.db.models import Count, Exists, F, Max, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce, Lower
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .api import endpoint
from .models import Achievement, Membership, User
from .portfolio import teacher_memberships, visible_achievements
from .review import matching_shares, pagination, positive, record_row, record_rows, status_filter, with_materials


def scope(request):
    group = positive(request.GET.get("group"))
    year = positive(request.GET.get("year"), maximum=2099)
    members = teacher_memberships(request.user)
    shares = matching_shares(request.user, group)
    if group:
        members = members.filter(group_id=group)
    records = visible_achievements(request.user).filter(pk__in=shares.values("achievement_id"))
    if year:
        records = records.filter(academic_year=year)
        members = members.filter(Q(group__year=year) | Q(student_id__in=records.values("owner_id")))
    return members, shares, records


def applications(request):
    items = Membership.objects.filter(group__owner=request.user, group__archived=False, status=Membership.Status.PENDING)
    group = positive(request.GET.get("group"))
    year = positive(request.GET.get("year"), maximum=2099)
    if group:
        items = items.filter(group_id=group)
    if year:
        items = items.filter(group__year=year)
    return items


@require_GET
@endpoint(User.Role.TEACHER)
def students(request):
    members, _, records = scope(request)
    activity = records.filter(owner_id=OuterRef("pk")).order_by().values("owner_id").annotate(count=Count("pk"), recent=Max("starts_on"))
    rows = User.objects.filter(role=User.Role.STUDENT, pk__in=members.values("student_id")).annotate(
        achievement_count=Coalesce(Subquery(activity.values("count")[:1]), 0), recent=Subquery(activity.values("recent")[:1]),
    )
    for term in request.GET.get("search", "").replace("\x00", "")[:120].split()[:8]:
        match = Q()
        for variant in sorted({term, term.lower(), term.upper(), term.capitalize()}):
            match |= Q(full_name__icontains=variant)
        rows = rows.filter(match)
    ordering = {"recent": (F("recent").desc(nulls_last=True),), "achievements": ("-achievement_count",)}
    page, window = pagination(rows.count(), positive(request.GET.get("page")) or 1)
    visible = list(rows.order_by(*ordering.get(request.GET.get("sort"), ()), Lower("full_name"), "pk")[window]
                   .values("id", "full_name", "achievement_count", "recent"))
    groups = {row["id"]: [] for row in visible}
    for membership in teacher_memberships(request.user).filter(student_id__in=groups).select_related("group").order_by("group__name", "group_id"):
        groups[membership.student_id].append({"id": membership.group_id, "name": membership.group.name})
    return JsonResponse({"students": [row | {"groups": groups[row["id"]]} for row in visible], **page})


@require_GET
@endpoint(User.Role.TEACHER)
def overview(request):
    members, shares, records = scope(request)
    totals = records.aggregate(achievements=Count("pk"), categories=Count("competition__category_id", distinct=True))
    verified = shares.filter(status=Achievement.Status.VERIFIED, achievement_id=OuterRef("pk"))
    pending = status_filter(shares, "action").filter(achievement_id__in=records.values("pk"))
    recent = record_rows(with_materials(records), shares, (F("starts_on").desc(nulls_last=True), "-created_at", "pk"))[:6]
    categories = list(records.filter(competition__isnull=False).values("competition__category__name")
                      .annotate(count=Count("pk")).order_by("-count", "competition__category__name")[:5])
    return JsonResponse({
        **totals, "students": members.filter(student__role=User.Role.STUDENT).values("student_id").distinct().count(),
        "verified": records.filter(Exists(verified)).count(),
        "attention": {"achievements": pending.values("achievement_id").distinct().count(), "applications": applications(request).count()},
        "recent": [record_row(record, User.Role.TEACHER) for record in recent],
        "directions": [{"name": row["competition__category__name"], "count": row["count"]} for row in categories],
    })


@require_GET
@endpoint(User.Role.TEACHER)
def membership_inbox(request):
    items = applications(request).order_by("requested_at", "pk")
    page, window = pagination(items.count(), positive(request.GET.get("page")) or 1)
    return JsonResponse({"applications": [{"id": item.pk, "full_name": item.student.full_name,
        "group": item.group.name, "group_id": item.group_id, "requested_at": item.requested_at}
        for item in items.select_related("group", "student")[window]], **page})

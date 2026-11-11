import re
import secrets
from datetime import timedelta
from hashlib import sha256

from django.db import transaction
from django.db.models import Count, Q
from django.http import JsonResponse
from django.utils import timezone
from django.utils.crypto import salted_hmac
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .api import ApiError, endpoint, invalid, json_body, text_field, throttled
from .models import Membership, StudyGroup, User

INVITE_PATTERN = re.compile(r"[0-9a-f]{24}", re.ASCII)
Status = Membership.Status


def invite_code(seed):
    return salted_hmac("postup.groups.invite.v1", seed, algorithm="sha256").hexdigest()[:24]


def digest(code):
    return sha256(code.encode("ascii")).hexdigest()


def group_data(group):
    return {"id": group.pk, "name": group.name, "year": group.year,
            "description": group.description, "archived": group.archived}


def membership_data(item):
    return {"id": item.pk, "status": item.status, "requested_at": item.requested_at,
            "full_name": item.student.full_name, "username": item.student.username}


def detail(group):
    invitation = None
    if group.invite_seed and not group.archived and group.invite_expires_at > timezone.now():
        code = invite_code(group.invite_seed)
        if digest(code) == group.invite_digest:
            invitation = {"code": code, "expires_at": group.invite_expires_at}
    return {**group_data(group), "invitation": invitation, "memberships": [
        membership_data(item) for item in group.memberships.select_related("student").order_by("-requested_at", "id")
    ]}


def owned(request, group_id, lock=False):
    query = StudyGroup.objects.filter(pk=group_id, owner=request.user)
    group = (query.select_for_update() if lock else query).first()
    if group is None:
        raise ApiError("missing", "Групу не знайдено або доступу до неї немає.", 404)
    return group


def group_fields(data):
    name = text_field(data, "name", 1, 100)
    description = text_field(data, "description", 0, 500)
    year = data.get("year")
    if type(year) is not int or not 2000 <= year <= 2099:
        invalid({"year": "Введіть рік початку навчання від 2000 до 2099."})
    return {"name": name, "year": year, "description": description}


def clear_invite(group):
    group.invite_seed = ""
    group.invite_digest = None
    group.invite_expires_at = None


@require_http_methods(["GET", "POST"])
@endpoint(User.Role.TEACHER)
def groups(request):
    if request.method == "POST":
        group = StudyGroup.objects.create(owner=request.user, **group_fields(json_body(request)))
        return JsonResponse(detail(group), status=201)
    items = StudyGroup.objects.filter(owner=request.user).annotate(
        pending=Count("memberships", filter=Q(memberships__status=Status.PENDING)),
        approved=Count("memberships", filter=Q(memberships__status=Status.APPROVED)),
    ).order_by("archived", "-year", "name", "id")
    return JsonResponse({"groups": [{**group_data(group), "pending": group.pending, "approved": group.approved}
                                    for group in items]})


@require_http_methods(["GET", "PATCH"])
@endpoint(User.Role.TEACHER)
def group_detail(request, group_id):
    if request.method == "GET":
        return JsonResponse(detail(owned(request, group_id)))
    data = json_body(request)
    with transaction.atomic():
        group = owned(request, group_id, lock=True)
        if data.get("archive") is True:
            group.archived = True
            clear_invite(group)
        else:
            for key, value in group_fields(data).items():
                setattr(group, key, value)
        group.save()
        return JsonResponse(detail(group))


@require_http_methods(["PUT", "DELETE"])
@endpoint(User.Role.TEACHER)
def invitation(request, group_id):
    with transaction.atomic():
        group = owned(request, group_id, lock=True)
        if request.method == "PUT":
            if group.archived:
                raise ApiError("archived", "Архівна група не приймає заявки.", 409)
            group.invite_seed = secrets.token_hex(16)
            group.invite_digest = digest(invite_code(group.invite_seed))
            group.invite_expires_at = timezone.now() + timedelta(days=7)
        else:
            clear_invite(group)
        group.save(update_fields=["invite_seed", "invite_digest", "invite_expires_at"])
        return JsonResponse(detail(group))


@require_http_methods(["PATCH"])
@endpoint(User.Role.TEACHER)
def membership(request, group_id, membership_id):
    transition = json_body(request).get("status")
    allowed = {Status.APPROVED: Status.PENDING, Status.REJECTED: Status.PENDING, Status.REMOVED: Status.APPROVED}
    if not isinstance(transition, str) or transition not in allowed:
        invalid({"status": "Оберіть доступну дію."})
    with transaction.atomic():
        group = owned(request, group_id, lock=True)
        item = group.memberships.filter(pk=membership_id).first()
        if item is None:
            raise ApiError("missing", "Запис учасника не знайдено.", 404)
        if item.status == transition:
            return JsonResponse(detail(group))
        if item.status != allowed[transition] or (group.archived and transition == Status.APPROVED):
            raise ApiError("conflict", "Стан заявки змінився або групу архівовано. Оновіть список.", 409)
        item.status = transition
        item.decided_at = timezone.now()
        item.save(update_fields=["status", "decided_at"])
        return JsonResponse(detail(group))


@require_POST
@endpoint(User.Role.STUDENT)
def join(request):
    blocked = throttled(request, "join", 150, 300)
    if blocked:
        return blocked
    blocked = throttled(request, f"join:{request.user.pk}", 30, 300)
    if blocked:
        return blocked
    data = json_body(request)
    code = text_field(data, "code", 1, 80).lower()
    submit = data.get("submit") is True
    if not INVITE_PATTERN.fullmatch(code):
        invalid({"code": "Перевірте код або попросіть учителя надіслати запрошення ще раз."})
    with transaction.atomic():
        group = StudyGroup.objects.select_for_update().filter(
            invite_digest=digest(code), invite_expires_at__gt=timezone.now(), archived=False,
        ).first()
        if group is None:
            raise ApiError("invite", "Запрошення недійсне. Попросіть учителя надіслати нове.", 404)
        item = group.memberships.filter(student=request.user).first()
        if submit and item is None:
            item = group.memberships.create(student=request.user)
        elif submit and item.status == Status.REMOVED:
            item.status = Status.PENDING
            item.requested_at = timezone.now()
            item.decided_at = None
            item.save(update_fields=["status", "requested_at", "decided_at"])
        return JsonResponse({"group": {"name": group.name, "year": group.year},
                             "status": item.status if item else None})


@require_GET
@endpoint(User.Role.STUDENT)
def memberships(request):
    items = request.user.memberships.select_related("group").order_by("-requested_at", "id")
    return JsonResponse({"memberships": [{
        "id": item.pk, "status": item.status, "requested_at": item.requested_at,
        "group": {"name": item.group.name, "year": item.group.year, "archived": item.group.archived},
    } for item in items]})

from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from django.db import transaction

from .models import (
    Achievement, Competition, CompetitionCategory, CompetitionCycle, CompetitionStage, ReleaseApproval,
    TeamParticipation, User,
)
from .portfolio import duplicate_key, event, reset_reviews, update_record


@admin.register(User)
class PostupUserAdmin(UserAdmin):
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Профіль", {"fields": ("full_name", "role", "is_active", "is_staff", "is_superuser")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": (
        "username", "full_name", "role", "password1", "password2",
    )}),)
    list_display = ("username", "full_name", "role", "is_active", "is_superuser")
    list_filter = ("role", "is_active", "is_superuser")
    search_fields = ("username", "full_name")


@admin.register(ReleaseApproval)
class ReleaseApprovalAdmin(admin.ModelAdmin):
    list_display = ("version", "teacher", "approved_at")
    list_filter = ("version",)
    ordering = ("-approved_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(CompetitionCategory)
admin.site.register(Competition)
admin.site.register(CompetitionCycle)
admin.site.register(CompetitionStage)


@admin.register(Achievement)
class AchievementAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "status", "declared_team", "team", "updated_at")
    list_filter = ("status", "participation", "competition")
    search_fields = ("declared_team", "competition_proposal")
    readonly_fields = tuple(field.name for field in Achievement._meta.fields)
    actions = ["link_team", "revise_team_result"]

    def get_queryset(self, request):
        return super().get_queryset(request).exclude(status=Achievement.Status.DRAFT)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.action(description="Підтвердити зв’язок вибраних записів зі спільною командою", permissions=["link_team"])
    def link_team(self, request, queryset):
        with transaction.atomic():
            records = list(Achievement.objects.select_for_update().filter(pk__in=queryset.values("pk")).order_by("pk"))
            team_ids = {record.team_id for record in records if record.team_id}
            if (not records or len(team_ids) > 1 or len({record.owner_id for record in records}) != len(records)
                    or any(record.status != Achievement.Status.SUBMITTED
                           or record.participation != Achievement.Participation.TEAM for record in records)):
                self.message_user(request, "Оберіть по одному поданому командному запису від кожного учасника.", messages.ERROR)
                return
            source = records[0]
            key = duplicate_key(source)
            outcome = source.shared_result()
            if any((record.competition_id, record.cycle_id, record.stage_id) != (source.competition_id, source.cycle_id, source.stage_id)
                   or duplicate_key(record) != key
                   or any(record.shared_result()[field] != outcome[field] for field in ("kind", "award", "placement", "score"))
                   or record.declared_team.casefold() != source.declared_team.casefold() for record in records):
                self.message_user(request, "Команда, конкурс, цикл, етап, секція та спільний результат мають збігатися.", messages.ERROR)
                return
            if team_ids:
                team = TeamParticipation.objects.select_for_update().get(pk=team_ids.pop())
                if team.records.exclude(pk__in=[record.pk for record in records]).filter(
                    owner_id__in=[record.owner_id for record in records],
                ).exists():
                    self.message_user(request, "У цій команді вже є інший запис одного з учасників.", messages.ERROR)
                    return
            else:
                team = TeamParticipation.objects.create(name=source.declared_team, result=outcome)
            for record in records:
                if record.team_id != team.pk:
                    record.team = team
                    record.version += 1
                    update_record(record, ["team", "version"])
                    reset_reviews(record, request.user, all_groups=True)
                    event(request.user, record, "team_linked")
        self.message_user(request, "Зв’язок із командою підтверджено.")

    def has_link_team_permission(self, request):
        return self.has_change_permission(request) and request.user.has_perm("postup.add_teamparticipation")

    @admin.action(description="Оновити командний результат за вибраним записом", permissions=["revise_team"])
    def revise_team_result(self, request, queryset):
        selected = list(queryset.values_list("pk", "team_id")[:2])
        if len(selected) != 1 or not selected[0][1]:
            self.message_user(request, "Виберіть один поданий запис зі встановленим зв’язком із командою.", messages.ERROR)
            return
        source_id, team_id = selected[0]
        with transaction.atomic():
            records = list(Achievement.objects.select_for_update().filter(team_id=team_id).order_by("pk"))
            source = next((record for record in records if record.pk == source_id), None)
            if source is None or source.status != Achievement.Status.SUBMITTED:
                self.message_user(request, "Доступність запису змінилася. Оновіть список.", messages.ERROR)
                return
            team = TeamParticipation.objects.select_for_update().get(pk=team_id)
            result = source.shared_result()
            delta = {f"team_{key}": [team.result.get(key), result[key]]
                     for key in ("kind", "award", "placement", "score") if team.result.get(key) != result[key]}
            if not delta:
                self.message_user(request, "Спільний результат уже збігається з вибраним записом.")
                return
            team.result = result
            team.save(update_fields=["result"])
            for record in records:
                record.version += 1
                update_record(record, ["version"])
                reset_reviews(record, request.user, all_groups=True)
                event(request.user, record, "team_result_changed", details={"changes": delta})
        self.message_user(request, "Спільний результат оновлено. Пов’язані подання повернуто на перевірку.")

    def has_revise_team_permission(self, request):
        return self.has_change_permission(request) and request.user.has_perm("postup.change_teamparticipation")

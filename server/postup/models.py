import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    REQUIRED_FIELDS = []

    class Role(models.TextChoices):
        STUDENT = "student", "Учень"
        TEACHER = "teacher", "Учитель"

    full_name = models.CharField("ПІБ", max_length=120)
    role = models.CharField("Роль", max_length=7, choices=Role, default=Role.STUDENT)

    def clean(self):
        super().clean()
        self.username = self.username.strip().lower()


class StudyGroup(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="study_groups")
    name = models.CharField(max_length=100)
    year = models.PositiveSmallIntegerField()
    description = models.CharField(max_length=500, blank=True)
    archived = models.BooleanField(default=False)
    invite_seed = models.CharField(max_length=32, blank=True)
    invite_digest = models.CharField(max_length=64, null=True, unique=True)
    invite_expires_at = models.DateTimeField(null=True)


class Membership(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Очікує підтвердження"
        APPROVED = "approved", "Підтверджено"
        REJECTED = "rejected", "Відхилено"
        REMOVED = "removed", "Членство завершено"

    group = models.ForeignKey(StudyGroup, on_delete=models.CASCADE, related_name="memberships")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="memberships")
    status = models.CharField(max_length=8, choices=Status, default=Status.PENDING)
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["group", "student"], name="one_membership_per_group")]


class RateBucket(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    expires_at = models.DateTimeField(db_index=True)
    count = models.PositiveIntegerField(default=0)


class ReleaseApproval(models.Model):
    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    version = models.CharField("Версія", max_length=32)
    approved_at = models.DateTimeField("Дата підтвердження", auto_now_add=True)

    class Meta:
        verbose_name = "Підтвердження версії"
        verbose_name_plural = "Підтвердження версій"
        constraints = [models.UniqueConstraint(fields=["teacher", "version"], name="one_approval_per_release")]


class AcademicProfile(models.Model):
    student = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="academic_profile")
    school = models.CharField(max_length=160, blank=True)
    grade = models.CharField(max_length=40, blank=True)
    locality = models.CharField(max_length=100, blank=True)
    interests = models.JSONField(default=list, blank=True)
    about = models.TextField(max_length=800, blank=True)
    goals = models.TextField(max_length=800, blank=True)
    skills = models.TextField(max_length=500, blank=True)
    links = models.JSONField(default=list, blank=True)
    revision = models.PositiveIntegerField(default=0)


class CompetitionCategory(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=120)

    def __str__(self):
        return self.name


class Competition(models.Model):
    slug = models.SlugField(unique=True)
    category = models.ForeignKey(CompetitionCategory, on_delete=models.PROTECT, related_name="competitions")
    name = models.CharField(max_length=160)
    asks_topic = models.BooleanField(default=False)
    team_by_default = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class CompetitionCycle(models.Model):
    competition = models.ForeignKey(Competition, on_delete=models.PROTECT, related_name="cycles")
    season = models.CharField(max_length=40)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["competition", "season"], name="one_cycle_per_season")]

    def __str__(self):
        return f"{self.competition} · {self.season}"


class CompetitionStage(models.Model):
    cycle = models.ForeignKey(CompetitionCycle, on_delete=models.PROTECT, related_name="stages")
    name = models.CharField(max_length=120)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["cycle", "name"], name="one_stage_name_per_cycle")]

    def __str__(self):
        return f"{self.cycle} · {self.name}"


class TeamParticipation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    # Snapshot of the common contest and original result, selected by an authorized reviewer.
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Achievement(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Чернетка"
        SUBMITTED = "submitted", "На перевірці"
        VERIFIED = "verified", "Підтверджено"
        CLARIFY = "clarify", "Потребує уточнення"
        REJECTED = "rejected", "Відхилено"

    class Participation(models.TextChoices):
        SOLO = "solo", "Індивідуальна"
        TEAM = "team", "Командна"

    class Result(models.TextChoices):
        PARTICIPATED = "participated", "Участь"
        AWARD = "award", "Нагорода"
        PLACEMENT = "placement", "Місце"
        OTHER = "other", "Інший результат"

    class Evidence(models.TextChoices):
        UNSPECIFIED = "", "Не зазначено"
        LATER = "later", "Додам пізніше"
        NOT_ISSUED = "not_issued", "Документ не видавався"
        LINK = "link", "Є посилання на результати"

    id = models.UUIDField(primary_key=True, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="achievements")
    competition = models.ForeignKey(Competition, null=True, blank=True, on_delete=models.PROTECT)
    cycle = models.ForeignKey(CompetitionCycle, null=True, blank=True, on_delete=models.PROTECT)
    stage = models.ForeignKey(CompetitionStage, null=True, blank=True, on_delete=models.PROTECT)
    competition_proposal = models.CharField(max_length=160, blank=True)
    season_proposal = models.CharField(max_length=40, blank=True)
    stage_proposal = models.CharField(max_length=120, blank=True)
    section = models.CharField(max_length=120, blank=True)
    topic = models.CharField(max_length=200, blank=True)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    academic_year = models.PositiveSmallIntegerField(null=True, blank=True)
    school = models.CharField(max_length=160, blank=True)
    grade = models.CharField(max_length=40, blank=True)
    participation = models.CharField(max_length=4, choices=Participation, default=Participation.SOLO)
    declared_team = models.CharField(max_length=120, blank=True)
    declared_members = models.TextField(max_length=500, blank=True)
    team = models.ForeignKey(TeamParticipation, null=True, blank=True, on_delete=models.PROTECT, related_name="records")
    result_kind = models.CharField(max_length=12, choices=Result, default=Result.PARTICIPATED)
    award = models.CharField(max_length=120, blank=True)
    placement = models.CharField(max_length=80, blank=True)
    score = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    description = models.TextField(max_length=1200, blank=True)
    results_url = models.URLField(max_length=500, blank=True)
    evidence = models.CharField(max_length=10, choices=Evidence, blank=True)
    status = models.CharField(max_length=9, choices=Status, default=Status.DRAFT)
    revision = models.PositiveIntegerField(default=1)
    version = models.PositiveIntegerField(default=0)
    submission_count = models.PositiveIntegerField(default=0)
    materials_revision = models.PositiveIntegerField(default=0)
    link_revision = models.PositiveIntegerField(default=0)
    changes_draft = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["owner", "status", "-updated_at"])]

    def __str__(self):
        return str(self.pk)

    def shared_result(self):
        return {
            "competition": str(self.competition) if self.competition_id else self.competition_proposal,
            "season": self.cycle.season if self.cycle_id else self.season_proposal,
            "stage": self.stage.name if self.stage_id else self.stage_proposal,
            "section": self.section,
            "kind": self.result_kind,
            "award": self.award,
            "placement": self.placement,
            "score": str(self.score) if self.score is not None else None,
        }

    def team_context(self):
        return (self.competition_id, self.cycle_id, self.stage_id, self.competition_proposal,
                self.season_proposal, self.stage_proposal, self.section, self.declared_team.casefold())


class AchievementShare(models.Model):
    achievement = models.ForeignKey(Achievement, on_delete=models.CASCADE, related_name="shares")
    membership = models.ForeignKey(Membership, on_delete=models.CASCADE, related_name="achievement_shares")
    status = models.CharField(max_length=9, choices=Achievement.Status, default=Achievement.Status.SUBMITTED)
    revision = models.PositiveIntegerField(default=1)
    first_version = models.PositiveIntegerField(default=1)
    submitted_at = models.DateTimeField(null=True, db_index=True)
    seen_materials = models.PositiveIntegerField(default=0)
    decision = models.ForeignKey("AchievementEvent", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["achievement", "membership"], name="one_share_per_membership")]


class Attachment(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    achievement = models.ForeignKey(Achievement, on_delete=models.CASCADE, related_name="attachments")
    filename = models.CharField(max_length=160)
    content_type = models.CharField(max_length=24)
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    added_revision = models.PositiveIntegerField(default=0)


class AttachmentContent(models.Model):
    attachment = models.OneToOneField(Attachment, primary_key=True, on_delete=models.CASCADE, related_name="content")
    data = models.BinaryField()


class AchievementEvent(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    achievement_id = models.UUIDField(db_index=True)
    action = models.CharField(max_length=24)
    attachment_id = models.UUIDField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    version = models.PositiveIntegerField(default=0)
    group = models.ForeignKey(StudyGroup, null=True, on_delete=models.SET_NULL, related_name="+")
    request_id = models.UUIDField(null=True, unique=True)
    details = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True)

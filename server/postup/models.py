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

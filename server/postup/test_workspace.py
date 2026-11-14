import uuid

from django.test import TestCase
from django.utils import timezone

from .models import Achievement, AchievementShare, Competition, Membership, StudyGroup, User
from .test_review import sign_in
from .tests import teacher


class WorkspaceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.teacher = teacher("workspace")
        cls.other = teacher("outside")
        cls.student = User.objects.create_user(username="inside", full_name="Софія Приклад")
        cls.stranger = User.objects.create_user(username="outside_student", full_name="Закритий Учень")
        cls.group = StudyGroup.objects.create(owner=cls.teacher, name="Перша", year=2026)
        cls.second = StudyGroup.objects.create(owner=cls.teacher, name="Друга", year=2026)
        cls.foreign = StudyGroup.objects.create(owner=cls.other, name="Чужа", year=2026)
        cls.archived = StudyGroup.objects.create(owner=cls.teacher, name="Архів", year=2026, archived=True)
        cls.record = Achievement.objects.create(id=uuid.uuid4(), owner=cls.student, competition=Competition.objects.first(),
            status="submitted", academic_year=2025, version=2, submission_count=2, award="Диплом", changes_draft={"reply": "Приватна чернетка"})
        for group, status in [(cls.group, "submitted"), (cls.second, "verified"), (cls.foreign, "clarify")]:
            member = Membership.objects.create(group=group, student=cls.student, status="approved")
            AchievementShare.objects.create(achievement=cls.record, membership=member, submitted_at=timezone.now(), status=status)
        for group in [cls.archived, cls.foreign]:
            Membership.objects.create(group=group, student=cls.stranger, status="approved")
        cls.pending = Membership.objects.create(group=cls.second, student=cls.stranger, status="pending")
        Achievement.objects.create(id=uuid.uuid4(), owner=cls.student, status="draft", competition_proposal="Приватний конкурс")

    def data(self, path, client=None, expected=200):
        result = (client or sign_in(self.teacher)).get(path)
        self.assertEqual(result.status_code, expected, result.content)
        return result.json()

    def test_directory_deduplicates_and_scopes_students(self):
        result = self.data("/api/teacher/students/?search=Софія&sort=achievements")
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["students"][0]["achievement_count"], 1)
        self.assertEqual({row["id"] for row in result["students"][0]["groups"]}, {self.group.pk, self.second.pk})
        self.assertNotIn("inside", str(result))
        for group in (self.foreign, self.archived):
            self.assertEqual(self.data(f"/api/teacher/students/?group={group.pk}")["total"], 0)
        self.assertEqual(self.data("/api/teacher/students/?search=Закритий")["total"], 0)
        self.data(f"/api/students/{self.stranger.pk}/profile/", expected=404)

    def test_overview_uses_group_decisions_and_event_academic_year(self):
        result = self.data("/api/teacher/overview/")
        self.assertEqual((result["students"], result["achievements"], result["verified"]), (1, 1, 1))
        self.assertEqual(result["attention"], {"achievements": 1, "applications": 1})
        self.assertEqual(len(result["recent"][0]["reviews"]), 2)
        self.assertNotIn("Приватна", str(result))
        self.assertEqual(self.data(f"/api/teacher/overview/?group={self.group.pk}&year=2025")["verified"], 0)
        self.assertEqual(self.data("/api/teacher/students/?year=2025")["total"], 1)
        self.assertEqual(self.data(f"/api/teacher/overview/?group={self.second.pk}&year=2025")["verified"], 1)
        self.assertEqual(self.data("/api/teacher/overview/?year=2026")["achievements"], 0)
        self.assertEqual(self.data(f"/api/teacher/overview/?group={self.foreign.pk}")["achievements"], 0)

    def test_inbox_and_library_use_authorized_rows(self):
        inbox = self.data("/api/teacher/applications/")
        self.assertEqual([row["id"] for row in inbox["applications"]], [self.pending.pk])
        self.assertEqual(self.data(f"/api/teacher/applications/?group={self.foreign.pk}")["total"], 0)
        self.assertEqual(self.data("/api/achievements/queue/?reason=revised")["total"], 1)
        self.assertEqual(self.data("/api/achievements/queue/?reason=new")["total"], 0)
        result = self.data("/api/achievements/?page=1&search=Софія+Диплом")
        self.assertEqual([row["id"] for row in result["records"]], [str(self.record.pk)])
        self.assertFalse(result["records"][0]["has_changes_draft"])

    def test_endpoints_enforce_roles_and_student_attention_is_private(self):
        learner = sign_in(self.student)
        for path in ("students", "overview", "applications"):
            self.data(f"/api/teacher/{path}/", learner, 403)
        self.assertEqual(self.data("/api/achievements/?page=1&status=needs_student", learner)["total"], 2)
        self.assertEqual(self.data("/api/achievements/?page=1&status=needs_student", sign_in(self.stranger))["total"], 0)

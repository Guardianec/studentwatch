import importlib
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch as mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, close_old_connections, connection
from django.db.migrations.executor import MigrationExecutor
from django.test import Client, TestCase, TransactionTestCase, override_settings
from PIL import Image
from pypdf import PdfWriter

from .models import (
    Achievement, AchievementEvent, AchievementShare, Attachment, AttachmentContent, Competition, CompetitionCategory,
    CompetitionCycle, CompetitionStage, Membership, StudyGroup, User,
)
from .tests import get_token, patch, post, teacher


def pdf():
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(output)
    return output.getvalue()


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class PortfolioTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user(username="student", full_name="Синтетичний Учень")
        self.other = User.objects.create_user(username="other", full_name="Інший Учень")
        self.first = teacher("first")
        self.second = teacher("second")
        self.group = StudyGroup.objects.create(owner=self.first, name="Перша група", year=2026)
        self.second_group = StudyGroup.objects.create(owner=self.second, name="Друга група", year=2026)
        self.member = Membership.objects.create(group=self.group, student=self.student, status=Membership.Status.APPROVED)
        self.second_member = Membership.objects.create(group=self.second_group, student=self.student, status=Membership.Status.APPROVED)
        self.clients = {actor.pk: Client() for actor in (self.student, self.other, self.first, self.second)}
        for actor in (self.student, self.other, self.first, self.second):
            self.clients[actor.pk].force_login(actor)
        self.owner = self.clients[self.student.pk]
        self.teacher = self.clients[self.first.pk]
        self.teacher2 = self.clients[self.second.pk]
        self.stranger = self.clients[self.other.pk]
        self.contest = Competition.objects.get(slug="man")
        self.cycle = CompetitionCycle.objects.create(competition=self.contest, season="2026/27")
        self.stage = CompetitionStage.objects.create(cycle=self.cycle, name="Етап для тесту")

    def draft(self, **values):
        return {
            "id": str(uuid.uuid4()), "competition_id": self.contest.pk, "cycle_id": self.cycle.pk,
            "stage_id": self.stage.pk, "section": "Тестова секція", "participation": "solo",
            "result_kind": "participated", "evidence": "later", "academic_year": 2026,
            "starts_on": None, "ends_on": None, "score": None, **values,
        }

    def create(self, client=None, **values):
        result = post(client or self.owner, "/api/achievements/", self.draft(**values))
        self.assertEqual(result.status_code, 201, result.content)
        return result.json()

    def path(self, item):
        return f"/api/achievements/{item['id']}/"

    def submit(self, item, client=None, **values):
        return post(client or self.owner, self.path(item) + "submit/", {
            "revision": item["revision"], "group_ids": [self.group.pk], **values,
        })

    def upload(self, item, raw=None, name="Синтетичний диплом.pdf", **fields):
        return self.owner.post(self.path(item) + "attachments/", {
            "file": SimpleUploadedFile(name, pdf() if raw is None else raw, content_type="application/pdf"),
            "id": str(uuid.uuid4()), "revision": item["revision"], **fields,
        })

    def test_profiles_are_scoped_and_revision_protects_identity_fields(self):
        path = f"/api/students/{self.student.pk}/profile/"
        initial = self.owner.get("/api/profile/").json()
        body = {**initial, "school": "Ліцей QA", "grade": "10-Б", "about": "Перший абзац\n\n<script>QA</script>",
                "links": ["https://example.org/profile"], "role": "teacher", "username": "spoofed", "owner": self.other.pk}
        response = patch(self.owner, "/api/profile/", body)
        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual((self.student.username, self.student.role), ("student", "student"))
        for client in (self.teacher, self.teacher2):
            profile = client.get(path)
            self.assertEqual(profile["Cache-Control"], "no-store")
            self.assertEqual(profile.json()["about"], body["about"])
            self.assertNotIn("username", profile.json())
            self.assertNotIn("email", profile.json())
        self.assertEqual(self.teacher.get(f"/api/students/{self.other.pk}/profile/").status_code, 404)
        self.assertEqual(self.stranger.get(path).status_code, 403)
        self.assertEqual(Client().get(path).status_code, 401)
        self.assertEqual(patch(self.owner, "/api/profile/", body).status_code, 409)
        for link in ("javascript:alert(1)", "data:text/plain,QA", "https://user:pass@example.org/"):
            response = patch(self.owner, "/api/profile/", {**body, "revision": 1, "links": [link]})
            self.assertIn("links", response.json()["fields"])
        record = self.create()
        self.assertEqual((record["school"], record["grade"]), ("Ліцей QA", "10-Б"))
        self.assertEqual(patch(self.owner, "/api/profile/", {**body, "revision": 1, "grade": "11-Б"}).status_code, 200)
        self.assertEqual(self.owner.get(self.path(record)).json()["grade"], "10-Б")

    def test_draft_and_attachment_are_visible_only_after_sharing_with_selected_groups(self):
        draft = self.create(group_ids=[self.group.pk], description="QA\n\n<script>literal</script>")
        path = self.path(draft)
        for client in (self.teacher, self.teacher2, self.stranger):
            self.assertEqual(client.get(path).status_code, 404)
            self.assertEqual(client.get("/api/achievements/").json()["records"], [])
        self.assertEqual(self.owner.get(path).json()["group_ids"], [self.group.pk])
        submitted = self.submit(draft)
        self.assertEqual(submitted.status_code, 200, submitted.content)
        self.assertFalse(submitted.json()["has_document"])
        self.assertEqual(submitted.json()["status"], "submitted")
        self.assertEqual(self.teacher.get(path).json()["description"], draft["description"])
        self.assertNotIn("group_ids", self.teacher.get(path).json())
        self.assertEqual(self.teacher2.get(path).status_code, 404)
        self.assertEqual(self.teacher2.get("/api/achievements/").json()["records"], [])
        self.assertEqual(patch(self.teacher, path, self.draft()).status_code, 403)
        self.assertEqual(patch(self.stranger, path, self.draft()).status_code, 404)
        raw = pdf()
        response = self.upload(submitted.json(), raw)
        self.assertEqual(response.status_code, 201, response.content)
        updated = response.json()
        self.assertTrue(updated["has_document"])
        self.assertEqual(updated["status"], "submitted")
        self.assertEqual(Achievement.objects.count(), 1)
        doc = path + f"attachments/{updated['attachments'][0]['id']}/download/"
        for client in (self.owner, self.teacher):
            result = client.get(doc)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(b"".join(result.streaming_content), raw)
            self.assertEqual(result["Cache-Control"], "private, no-store")
            self.assertEqual(result["X-Content-Type-Options"], "nosniff")
            self.assertIn("attachment;", result["Content-Disposition"])
        for client in (self.teacher2, self.stranger):
            self.assertEqual(client.get(doc).status_code, 404)
        self.assertEqual(Client().get(doc).status_code, 401)
        self.assertEqual(set(AchievementEvent.objects.values_list("action", flat=True)),
                         {"created", "submitted", "attachment_added", "access_granted"})

    def test_multi_group_visibility_ends_on_removal_and_does_not_resume_on_rejoin(self):
        item = self.create()
        shared = self.submit(item, group_ids=[self.group.pk, self.second_group.pk]).json()
        stored = self.upload(shared).json()
        doc = self.path(item) + f"attachments/{stored['attachments'][0]['id']}/download/"
        group_path = f"/api/groups/{self.group.pk}/"
        self.assertEqual(self.teacher.get(doc).status_code, 200)
        self.assertEqual(self.teacher2.get(doc).status_code, 200)
        self.assertEqual(patch(self.teacher, group_path + f"members/{self.member.pk}/", {"status": "removed"}).status_code, 200)
        self.assertEqual(self.teacher.get(self.path(item)).status_code, 404)
        self.assertEqual(self.teacher.get(doc).status_code, 404)
        self.assertEqual(self.teacher.get(f"/api/students/{self.student.pk}/profile/").status_code, 404)
        self.assertEqual(self.teacher.get(group_path).json()["memberships"], [])
        self.assertEqual(self.teacher2.get(doc).status_code, 200)
        self.assertEqual(Attachment.objects.count(), 1)
        self.assertEqual(AchievementShare.objects.count(), 1)
        Membership.objects.filter(pk=self.member.pk).update(status=Membership.Status.APPROVED)
        self.assertEqual(self.teacher.get(doc).status_code, 404)
        withdrawn = post(self.owner, self.path(item) + "withdraw/", {"revision": stored["revision"]})
        self.assertEqual(withdrawn.json()["status"], "draft")
        self.assertEqual(self.teacher2.get(doc).status_code, 404)
        self.assertEqual(self.owner.get(doc).status_code, 200)
        self.assertTrue(AchievementEvent.objects.filter(action="access_revoked", actor=self.first).exists())

    def test_spoofed_groups_fields_and_stale_drafts_are_rejected(self):
        unavailable = StudyGroup.objects.create(owner=self.first, name="Чужа", year=2026)
        data = self.draft(owner_id=self.other.pk, status="verified", verification_status="verified", role="teacher",
                          team_id=str(uuid.uuid4()), group_ids=[unavailable.pk])
        self.assertIn("group_ids", post(self.owner, "/api/achievements/", data).json()["fields"])
        self.assertEqual(Achievement.objects.count(), 0)
        data["group_ids"] = []
        item = post(self.owner, "/api/achievements/", data).json()
        self.assertEqual((item["student"]["id"], item["status"], item["team"]), (self.student.pk, "draft", None))
        self.assertEqual(self.submit(item, group_ids=[unavailable.pk]).status_code, 400)
        self.assertEqual(self.submit(item, group_ids=[True]).status_code, 400)
        self.assertEqual(self.submit(item, group_ids=[]).status_code, 400)
        response = patch(self.owner, self.path(item), {**data, "revision": item["revision"], "score": "0"})
        self.assertEqual(response.json()["score"], "0.0000")
        self.assertEqual(patch(self.owner, self.path(item), {**data, "revision": item["revision"]}).status_code, 409)
        self.assertEqual(self.submit(response.json()).json()["status"], "submitted")
        Achievement.objects.filter(pk=item["id"]).update(status=Achievement.Status.VERIFIED)
        self.assertEqual(post(self.owner, self.path(item) + "withdraw/", {"revision": 3}).status_code, 409)
        self.assertEqual(self.upload({**item, "revision": 3}).status_code, 409)

    def test_idempotency_and_warning_for_similar_results(self):
        data = self.draft()
        item = post(self.owner, "/api/achievements/", data)
        self.assertEqual(item.status_code, 201)
        repeated = post(self.owner, "/api/achievements/", data)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json()["id"], item.json()["id"])
        self.assertEqual(post(self.stranger, "/api/achievements/", data).status_code, 404)
        first = self.submit(item.json())
        self.assertEqual(self.submit(item.json()).json(), first.json())
        self.assertEqual(AchievementEvent.objects.filter(action="submitted").count(), 1)
        duplicate = self.create(award="Особлива відзнака", result_kind="award")
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(self.submit(duplicate).json()["code"], "duplicate")
        self.assertEqual(self.submit(duplicate, allow_duplicate=True).status_code, 200)
        for fields in (
            {"section": "Інша секція"},
            {"stage_id": None, "stage_proposal": "Інший етап"},
            {"cycle_id": None, "season_proposal": "2027/28", "stage_id": None},
            {"participation": "team", "declared_team": "QA"},
        ):
            self.assertFalse(self.create(**fields)["duplicate"])

    def test_catalogue_proposals_stay_private_and_references_are_consistent(self):
        catalogue = self.owner.get("/api/catalogue/").json()["categories"]
        self.assertEqual(len(catalogue), 6)
        self.assertEqual(len(next(item for item in catalogue if len(item["competitions"]) == 2)["competitions"]), 2)
        self.assertEqual(Client().get("/api/catalogue/").status_code, 401)
        count = Competition.objects.count()
        item = self.create(competition_id=None, competition_proposal="Вигаданий турнір", cycle_id=None,
                           season_proposal="2026", stage_id=None, stage_proposal="Невідомий етап")
        self.assertEqual(self.submit(item).status_code, 200)
        self.assertEqual(Competition.objects.count(), count)
        self.assertEqual(post(self.owner, "/api/achievements/", self.draft(competition_id=None)).status_code, 400)
        other_cycle = CompetitionCycle.objects.create(competition=self.contest, season="Інший цикл")
        self.assertEqual(post(self.owner, "/api/achievements/", self.draft(cycle_id=other_cycle.pk)).status_code, 400)

    def test_attachment_validation_normalization_quota_and_csrf(self):
        item = self.create()
        for invalid_file in (b"<html>QA</html>", b"%PDF-1.7\nMalformed PDF\n%%EOF", b"\x89PNG\r\n\x1a\nInvalid"):
            self.assertIn("file", self.upload(item, invalid_file).json()["fields"])
        with override_settings(ATTACHMENT_BYTES=1024):
            self.assertEqual(self.upload(item, b"x" * 2048).status_code, 400)
        image = Image.new("RGB", (20, 20), "white")
        exif = Image.Exif()
        exif[270] = "Synthetic private metadata"
        original = io.BytesIO()
        image.save(original, "JPEG", exif=exif)
        with override_settings(ATTACHMENT_PIXELS=100):
            self.assertIn("file", self.upload(item, original.getvalue()).json()["fields"])
        with override_settings(ATTACHMENT_COUNT=1):
            updated = self.upload(item, original.getvalue(), name="wrong.pdf").json()
            attachment = updated["attachments"][0]
            self.assertEqual(attachment["filename"], "wrong.jpg")
            content = AttachmentContent.objects.get(pk=attachment["id"]).data
            self.assertFalse(Image.open(io.BytesIO(content)).getexif())
            self.assertIn("file", self.upload(updated).json()["fields"])
        with override_settings(ATTACHMENT_QUOTA=1):
            self.assertIn("file", self.upload(updated).json()["fields"])
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(self.student)
        body = {"file": SimpleUploadedFile("QA.pdf", pdf()), "id": str(uuid.uuid4()), "revision": updated["revision"]}
        self.assertEqual(csrf_client.post(self.path(item) + "attachments/", body).status_code, 403)
        body["file"] = SimpleUploadedFile("QA.pdf", pdf())
        self.assertEqual(csrf_client.post(self.path(item) + "attachments/", body, HTTP_X_CSRFTOKEN=get_token(csrf_client)).status_code, 201)

    def test_failed_replacement_keeps_original_and_retry_does_not_duplicate(self):
        item = self.create()
        first = self.upload(item).json()
        old_id = first["attachments"][0]["id"]
        path = self.path(item)
        with mock("postup.attachments.AttachmentContent.objects.create", side_effect=DatabaseError):
            self.assertEqual(self.upload(first, replace_id=old_id).status_code, 503)
        self.assertEqual(Attachment.objects.count(), 1)
        self.assertEqual(AttachmentContent.objects.count(), 1)
        self.assertEqual(self.owner.get(path).json()["revision"], first["revision"])
        new_id = str(uuid.uuid4())
        replace = self.upload(first, replace_id=old_id, id=new_id)
        self.assertEqual(replace.status_code, 201, replace.content)
        self.assertEqual(self.upload(first, replace_id=old_id, id=new_id).status_code, 200)
        self.assertFalse(AttachmentContent.objects.filter(pk=old_id).exists())
        self.assertEqual(AttachmentContent.objects.count(), 1)
        removed = self.owner.delete(path + f"attachments/{new_id}/", {"revision": replace.json()["revision"]},
                                    content_type="application/json")
        self.assertEqual(removed.json()["attachments"], [])
        self.assertEqual(AttachmentContent.objects.count(), 0)
        self.assertEqual(self.owner.delete(path, {"revision": removed.json()["revision"]}, content_type="application/json").status_code, 200)
        self.assertEqual(self.owner.get(path).status_code, 404)
        self.assertEqual(post(self.owner, "/api/achievements/", self.draft(id=item["id"])).status_code, 409)

    def test_team_links_require_admin_and_do_not_disclose_peer_accounts(self):
        Membership.objects.create(group=self.second_group, student=self.other, status=Membership.Status.APPROVED)
        proposal = {"participation": "team", "declared_team": "Синтетична команда", "declared_members": "Учасник А\nУчасник Б"}
        first = self.create(**proposal)
        second = self.create(self.stranger, **proposal)
        self.assertEqual(self.submit(first).status_code, 200)
        self.assertEqual(self.submit(second, self.stranger, group_ids=[self.second_group.pk]).status_code, 200)
        self.assertEqual(self.teacher.get(self.path(second)).status_code, 404)
        self.assertIsNone(self.owner.get(self.path(first)).json()["team"])
        admin = Client()
        admin.force_login(User.objects.create_superuser(username="admin"))
        request = {"action": "link_team", "_selected_action": [first["id"], second["id"]], "index": 0}
        admin_url = "/admin/postup/achievement/"
        self.assertEqual(self.teacher.post(admin_url, request).status_code, 302)
        self.assertEqual(admin.post(admin_url, request).status_code, 302)
        linked = self.owner.get(self.path(first)).json()["team"]
        self.assertIsNotNone(linked)
        self.assertEqual(linked["id"], self.stranger.get(self.path(second)).json()["team"]["id"])
        self.assertEqual(set(linked), {"id", "name", "result"})
        self.assertNotIn(self.other.full_name, str(linked))
        self.assertEqual(self.owner.get(self.path(second)).status_code, 404)
        self.assertEqual(AchievementEvent.objects.filter(action="team_linked").count(), 2)


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
class ConcurrentPortfolioTests(TransactionTestCase):
    def test_parallel_retry_creates_one_record_and_one_event(self):
        learner = User.objects.create_user(username="concurrent-learner")
        data = {"id": str(uuid.uuid4()), "participation": "solo", "result_kind": "participated", "evidence": ""}
        start = Barrier(2, timeout=5)

        def request():
            client = Client()
            try:
                client.force_login(learner)
                start.wait()
                response = post(client, "/api/achievements/", data)
                return response.status_code, response.json()["id"]
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: request(), range(2)))
        self.assertEqual(sorted(results), [(200, data["id"]), (201, data["id"])])
        self.assertEqual(Achievement.objects.filter(owner=learner).count(), 1)
        self.assertEqual(AchievementEvent.objects.filter(actor=learner, action="created").count(), 1)


class PortfolioMigrationTests(TransactionTestCase):
    def test_upgrade_keeps_accounts_and_memberships_and_seeds_idempotently(self):
        previous = [("postup", "0002_release_approval")]
        current = [("postup", "0003_portfolio")]
        executor = MigrationExecutor(connection)
        executor.migrate(previous)
        try:
            old = executor.loader.project_state(previous).apps
            old_user = old.get_model("postup", "User")
            student = old_user.objects.create(username="legacy-student", full_name="Учень 0.2.0")
            teacher_account = old_user.objects.create(username="legacy-teacher", role="teacher")
            group = old.get_model("postup", "StudyGroup").objects.create(owner_id=teacher_account.pk, name="Група 0.2.0", year=2025)
            member = old.get_model("postup", "Membership").objects.create(group_id=group.pk, student_id=student.pk, status="approved")
            MigrationExecutor(connection).migrate(current)
            self.assertEqual(User.objects.get(pk=student.pk).full_name, "Учень 0.2.0")
            self.assertEqual(Membership.objects.get(pk=member.pk).group.name, "Група 0.2.0")
            self.assertEqual(Membership.objects.get(pk=member.pk).status, "approved")
            seed = importlib.import_module("postup.migrations.0003_portfolio").seed_catalogue
            Competition.objects.filter(slug="icpc").update(name="ICPC · QA")
            with connection.schema_editor() as editor:
                seed(MigrationExecutor(connection).loader.project_state(current).apps, editor)
            self.assertEqual(CompetitionCategory.objects.count(), 6)
            self.assertEqual(Competition.objects.count(), 7)
            self.assertEqual(Competition.objects.get(slug="icpc").name, "ICPC · QA")
        finally:
            final = MigrationExecutor(connection)
            final.migrate(final.loader.graph.leaf_nodes())

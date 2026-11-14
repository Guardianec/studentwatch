import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless

from django.db import close_old_connections, connection
from django.db.migrations.executor import MigrationExecutor
from django.test import Client, TestCase, TransactionTestCase, override_settings

from .models import Achievement, AchievementEvent, AchievementShare, AttachmentContent, Competition, Membership, StudyGroup, User
from .test_portfolio import pdf
from .tests import patch, post, teacher


def draft(**values):
    return {"id": str(uuid.uuid4()), "competition_proposal": "Синтетичний конкурс", "season_proposal": "2026",
            "stage_proposal": "Етап 1", "participation": "solo", "result_kind": "participated",
            "evidence": "", "academic_year": 2026, **values}


def record_path(record):
    return f"/api/achievements/{record['id']}/"


def review_body(record, group, action, **values):
    share = next(item for item in record["reviews"] if item["group_id"] == group.pk)
    return {"action": action, "version": record["version"], "share_revision": share["revision"],
            "materials_revision": record["materials_revision"], "request_id": str(uuid.uuid4()), **values}


def sign_in(user):
    client = Client()
    client.force_login(user)
    return client


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ReviewTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user(username="learner", full_name="Тестовий Учень")
        self.other = User.objects.create_user(username="outsider")
        self.teacher = teacher("mentor")
        self.second = teacher("mentor2")
        self.group = StudyGroup.objects.create(owner=self.teacher, name="Група А", year=2026)
        self.group_b = StudyGroup.objects.create(owner=self.second, name="Група Б", year=2026)
        self.member = Membership.objects.create(group=self.group, student=self.student, status="approved")
        Membership.objects.create(group=self.group_b, student=self.student, status="approved")
        self.owner, self.a, self.b, self.stranger = map(sign_in, (self.student, self.teacher, self.second, self.other))

    def ok(self, response, code=200):
        self.assertEqual(response.status_code, code, response.content)
        return response.json()

    def submitted(self, **values):
        record = self.ok(post(self.owner, "/api/achievements/", draft(**values)), 201)
        return self.ok(self.submit(record))

    def submit(self, record, **values):
        return post(self.owner, record_path(record) + "submit/", {
            "revision": record["revision"], "group_ids": [self.group.pk, self.group_b.pk],
            "request_id": str(uuid.uuid4()), "allow_duplicate": True, **values,
        })

    def decide(self, record, action, client=None, group=None, **values):
        group = group or self.group
        return post(client or self.a, record_path(record) + f"review/{group.pk}/",
                    review_body(record, group, action, **values))

    def upload(self, record, **values):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return self.ok(self.owner.post(record_path(record) + "attachments/", {
            "file": SimpleUploadedFile("QA.pdf", pdf()), "revision": record["revision"],
            "id": str(uuid.uuid4()), **values,
        }), 201)

    def test_clarification_resubmission_and_materials_do_not_overwrite_other_decisions(self):
        old = self.submitted(evidence="later")
        path = record_path(old)
        self.assertEqual(old["version"], 1)
        self.assertEqual(self.decide(old, "clarify").status_code, 400)
        self.assertEqual(self.decide(old, "verified", basis="protocol").status_code, 400)
        self.ok(self.decide(old, "clarify", comment="Уточніть етап <b>QA</b>"))
        self.ok(self.decide(old, "verified", self.b, self.group_b, basis="known", comment="Бачив результат."))
        current = self.ok(self.owner.get(path))
        self.assertEqual([item["status"] for item in current["reviews"]], ["clarify", "verified"])
        self.assertEqual([item["group"] for item in self.ok(self.a.get(path))["reviews"]], [self.group.name])
        self.assertNotIn("Бачив", str(self.ok(self.a.get(path + "history/"))))
        saved = self.ok(patch(self.owner, path, {**current, "stage_proposal": "Етап 2", "reply": "Виправив назву."}))
        self.assertEqual(saved["changes_draft"]["stage_proposal"], "Етап 2")
        teacher_view = self.ok(self.a.get(path))
        self.assertNotIn("changes_draft", teacher_view)
        self.assertNotIn("revision", teacher_view)
        self.assertEqual(teacher_view["updated_at"], current["updated_at"])
        self.assertEqual((teacher_view["stage_name"], teacher_view["version"]), ("Етап 1", 1))
        request_id = str(uuid.uuid4())
        newer = self.ok(self.submit(saved, request_id=request_id))
        self.ok(self.submit(saved, request_id=request_id))
        self.assertEqual((newer["stage_name"], newer["version"]), ("Етап 2", 2))
        self.assertEqual([item["status"] for item in newer["reviews"]], ["submitted", "submitted"])
        self.assertEqual(self.decide(old, "verified", basis="known", comment="Стара версія.").status_code, 409)
        history = self.ok(self.a.get(path + "history/"))["events"]
        change = next(item for item in history if item["action"] == "resubmitted")
        self.assertEqual(change["details"], {"changes": {"stage_name": ["Етап 1", "Етап 2"]}, "reply": "Виправив назву."})
        self.assertEqual(next(item for item in history if item["action"] == "clarify")["version"], 1)
        self.ok(self.decide(newer, "verified", basis="protocol", comment="Міський протокол № 1."))
        with_file = self.upload(self.ok(self.owner.get(path)))
        for item in with_file["reviews"]:
            self.assertTrue(item["new_materials"])
        self.assertEqual(with_file["reviews"][0]["status"], "verified")
        self.ok(self.decide(with_file, "materials_seen"))
        self.assertFalse(self.ok(self.a.get(path))["reviews"][0]["new_materials"])
        self.assertTrue(self.ok(self.b.get(path))["reviews"][0]["new_materials"])
        changed = self.ok(self.owner.get(path))
        draft_change = self.ok(patch(self.owner, path, {**changed, "result_kind": "award", "award": "Синтетична відзнака"}))
        self.assertEqual(self.ok(self.a.get(path))["result_kind"], "participated")
        self.assertEqual([review["status"] for review in self.ok(self.submit(draft_change))["reviews"]], ["submitted", "submitted"])

    def test_basis_replacement_revocation_rejection_and_idempotent_notices(self):
        record = self.upload(self.submitted())
        path = record_path(record)
        old_attachment = record["attachments"][0]["id"]
        body = review_body(record, self.group, "verified", basis="document", attachment_ids=[old_attachment])
        self.ok(post(self.a, path + f"review/{self.group.pk}/", body))
        self.ok(post(self.a, path + f"review/{self.group.pk}/", body))
        self.assertEqual(AchievementEvent.objects.filter(action="verified").count(), 1)
        self.ok(self.decide(record, "verified", self.b, self.group_b, basis="known", comment="Особисто перевірено."))
        notices = self.ok(self.owner.get("/api/notifications/"))
        self.assertEqual(notices["unread"], 2)
        read = f"/api/notifications/{notices['notifications'][0]['id']}/read/"
        self.assertEqual(post(self.stranger, read).status_code, 404)
        self.ok(post(self.owner, read))
        self.ok(post(self.owner, read))
        self.assertEqual(self.ok(self.owner.get("/api/notifications/"))["unread"], 1)
        replaced = self.upload(self.ok(self.owner.get(path)), replace_id=old_attachment)
        self.assertEqual([item["status"] for item in replaced["reviews"]], ["submitted", "verified"])
        self.assertFalse(AttachmentContent.objects.filter(pk=old_attachment).exists())
        self.assertEqual(self.a.get(path + f"attachments/{old_attachment}/download/").status_code, 404)
        self.assertEqual(self.decide(replaced, "confirmation_revoked", self.b, self.group_b).status_code, 400)
        self.ok(self.decide(replaced, "confirmation_revoked", self.b, self.group_b, comment="Потрібна повторна перевірка."))
        self.assertEqual(self.decide(replaced, "rejected").status_code, 400)
        self.ok(self.decide(replaced, "rejected", comment="Нагорода не збігається."))
        declined = self.ok(self.owner.get(path))
        edited = self.ok(patch(self.owner, path, {**declined, "award": "Виправлена відзнака"}))
        self.assertEqual(self.ok(self.submit(edited))["reviews"][0]["status"], "submitted")
        history = self.ok(self.a.get(path + "history/"))["events"]
        self.assertEqual(next(item for item in history if item["action"] == "verified")["details"]["removed_documents"], 1)

    def test_search_scope_counts_and_history_follow_active_access(self):
        record = self.submitted(competition_id=Competition.objects.get(slug="man").pk)
        path = record_path(record)
        self.ok(self.decide(record, "verified", basis="other", comment="Перевірив за джерелом."))
        self.ok(self.decide(record, "verified", self.b, self.group_b, basis="other", comment="Група Б."))
        self.assertEqual(self.ok(self.owner.get("/api/achievements/?page=1&year=2026"))["counts"],
                         {"unique": 1, "verified": 1, "categories": 1})
        self.assertEqual(self.ok(self.a.get(f"/api/achievements/?page=1&group={self.group_b.pk}"))["counts"]["unique"], 0)
        self.assertEqual(self.ok(self.b.get("/api/achievements/?page=1&participation=team"))["counts"]["unique"], 0)
        self.assertEqual(self.ok(self.a.get("/api/achievements/queue/?status=verified&search=Тестовий+МАН"))["total"], 1)
        self.assertEqual(self.ok(self.a.get("/api/achievements/queue/"))["total"], 0)
        self.assertEqual(self.stranger.get(path + "history/").status_code, 404)
        self.assertEqual(self.decide(record, "rejected", self.a, self.group_b, comment="Стороння група").status_code, 404)
        self.ok(patch(self.a, f"/api/groups/{self.group.pk}/members/{self.member.pk}/", {"status": "removed"}))
        self.assertEqual(self.a.get(path + "history/").status_code, 404)
        self.assertEqual(self.ok(self.b.get(path + "history/"))["total"], 3)
        self.assertNotIn("Група Б.", str(self.ok(self.owner.get(path + f"history/?group={self.group.pk}"))))

    def test_queue_pagination_and_portfolio_group_status_are_scoped(self):
        for _ in range(21):
            self.submitted()
        queue = "/api/achievements/queue/?search=тестовий"
        first = self.ok(self.a.get(queue + "&page=1"))
        second = self.ok(self.a.get(queue + "&page=2"))
        self.assertEqual((first["total"], first["pages"], len(first["records"]), len(second["records"])), (21, 2, 20, 1))
        self.assertNotIn(second["records"][0]["id"], {item["id"] for item in first["records"]})
        record = self.ok(self.owner.get(record_path(second["records"][0])))
        self.ok(self.decide(record, "verified", basis="known", comment="QA"))
        portfolio = "/api/achievements/?status=verified&page=1&group="
        self.assertEqual(self.ok(self.owner.get(portfolio + str(self.group.pk)))["counts"]["unique"], 1)
        self.assertEqual(self.ok(self.owner.get(portfolio + str(self.group_b.pk)))["counts"]["unique"], 0)

    def test_removing_unreviewed_unused_file_clears_notice_without_affecting_confirmation(self):
        record = self.submitted()
        self.ok(self.decide(record, "verified", basis="known", comment="QA"))
        attached = self.upload(self.ok(self.owner.get(record_path(record))))
        attachment_id = attached["attachments"][0]["id"]
        self.assertTrue(attached["reviews"][0]["new_materials"])
        removed = self.ok(self.owner.delete(record_path(record) + f"attachments/{attachment_id}/",
                          {"revision": attached["revision"]}, content_type="application/json"))
        self.assertFalse(removed["reviews"][0]["new_materials"])
        self.assertEqual(removed["reviews"][0]["status"], "verified")

    def test_team_verification_is_personal_and_shared_result_changes_reset_linked_records(self):
        Membership.objects.create(group=self.group_b, student=self.other, status="approved")
        team_values = dict(participation="team", declared_team="QA", declared_members="Синтетичний склад",
                           result_kind="award", award="Перша відзнака")
        first = self.submitted(**team_values)
        another = self.ok(post(self.stranger, "/api/achievements/", draft(**team_values)), 201)
        self.ok(post(self.stranger, record_path(another) + "submit/", {"revision": another["revision"], "group_ids": [self.group_b.pk]}))
        admin = sign_in(User.objects.create_superuser(username="qa-admin"))
        admin_url = "/admin/postup/achievement/"
        self.assertEqual(admin.post(admin_url, {"action": "link_team", "_selected_action": [first["id"], another["id"]], "index": 0}).status_code, 302)
        current = self.ok(self.owner.get(record_path(first)))
        linked = self.ok(self.stranger.get(record_path(another)))
        self.assertEqual(current["team"]["id"], linked["team"]["id"])
        self.assertEqual(self.decide(current, "verified", basis="known", comment="QA").status_code, 400)
        self.ok(self.decide(current, "verified", basis="known", comment="QA", team_member_confirmed=True))
        self.assertEqual(linked["reviews"][0]["status"], "submitted")
        self.assertEqual(self.a.get(record_path(linked)).status_code, 404)
        self.ok(self.decide(linked, "verified", self.b, self.group_b, basis="known", comment="QA", team_member_confirmed=True))
        edit = self.ok(patch(self.owner, record_path(first), {**current, "award": "Нова спільна відзнака"}))
        self.ok(self.submit(edit))
        self.assertEqual(admin.post(admin_url, {"action": "revise_team_result", "_selected_action": [first["id"]], "index": 0}).status_code, 302)
        new_linked = self.ok(self.stranger.get(record_path(another)))
        self.assertGreater(new_linked["version"], linked["version"])
        self.assertEqual(new_linked["reviews"][0]["status"], "submitted")
        self.assertEqual(new_linked["team"]["result"]["award"], "Нова спільна відзнака")


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
class ConcurrentReviewTests(TransactionTestCase):
    def test_old_decision_racing_resubmission_cannot_confirm_new_version(self):
        pupil = User.objects.create_user(username="pupil")
        mentor = teacher("reviewer")
        group = StudyGroup.objects.create(owner=mentor, name="Група QA", year=2026)
        Membership.objects.create(group=group, student=pupil, status="approved")
        owner, reviewer = sign_in(pupil), sign_in(mentor)
        record = post(owner, "/api/achievements/", draft()).json()
        path = record_path(record)
        old = post(owner, path + "submit/", {"revision": record["revision"], "group_ids": [group.pk]}).json()
        saved = patch(owner, path, {**old, "stage_proposal": "Новий етап"}).json()
        decision = review_body(old, group, "verified", basis="other", comment="QA")
        start = Barrier(2, timeout=5)

        def run(client, url, payload):
            try:
                start.wait()
                return post(client, url, payload).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            submit = pool.submit(run, owner, path + "submit/", {"revision": saved["revision"], "group_ids": [group.pk]})
            review = pool.submit(run, reviewer, path + f"review/{group.pk}/", decision)
            self.assertEqual(submit.result(timeout=10), 200)
            self.assertIn(review.result(timeout=10), (200, 409))
        self.assertEqual(Achievement.objects.get(pk=record["id"]).version, 2)
        self.assertEqual(AchievementShare.objects.get(achievement_id=record["id"]).status, "submitted")
        self.assertFalse(AchievementEvent.objects.filter(achievement_id=record["id"], version=2, action="verified").exists())


class ReviewMigrationTests(TransactionTestCase):
    def test_existing_result_shares_evidence_and_events_are_preserved(self):
        previous = [("postup", "0003_portfolio")]
        current = [("postup", "0004_review")]
        executor = MigrationExecutor(connection)
        executor.migrate(previous)
        try:
            old = executor.loader.project_state(previous).apps
            pupil = old.get_model("postup", "User").objects.create(username="qa-pupil")
            mentor = old.get_model("postup", "User").objects.create(username="qa-mentor", role="teacher")
            group = old.get_model("postup", "StudyGroup").objects.create(owner=mentor, name="Група QA", year=2026)
            member = old.get_model("postup", "Membership").objects.create(group=group, student=pupil, status="approved")
            record = old.get_model("postup", "Achievement").objects.create(id=uuid.uuid4(), owner=pupil, status="submitted")
            share = old.get_model("postup", "AchievementShare").objects.create(achievement=record, membership=member)
            item = old.get_model("postup", "Attachment").objects.create(id=uuid.uuid4(), achievement=record, size=3)
            old.get_model("postup", "AttachmentContent").objects.create(attachment=item, data=b"abc")
            event = old.get_model("postup", "AchievementEvent").objects.create(actor=pupil, achievement_id=record.pk, action="submitted")
            MigrationExecutor(connection).migrate(current)
            self.assertEqual(Achievement.objects.get(pk=record.pk).version, 1)
            self.assertEqual(AchievementShare.objects.get(pk=share.pk).status, "submitted")
            self.assertEqual(AchievementShare.objects.get(pk=share.pk).submitted_at, event.created_at)
            self.assertEqual(bytes(AttachmentContent.objects.get(pk=item.pk).data), b"abc")
            self.assertEqual(AchievementEvent.objects.get(pk=event.pk).version, 1)
        finally:
            final = MigrationExecutor(connection)
            final.migrate(final.loader.graph.leaf_nodes())

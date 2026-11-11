import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.conf import settings
from django.contrib.sessions.models import Session
from django.db import close_old_connections, connection
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from unittest import skipUnless

from .models import Membership, ReleaseApproval, StudyGroup, User

PASSWORD = "Larch!River!Cobalt_286"


def teacher(username):
    return User.objects.create_user(username=username, password=PASSWORD, full_name="Тестовий учитель", role=User.Role.TEACHER)


def post(client, path, data=None, **headers):
    return client.post(path, data or {}, content_type="application/json", **headers)


def patch(client, path, data):
    return client.patch(path, data, content_type="application/json")


def get_token(client):
    return client.get("/api/session/").json()["csrf"]


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class AccountsTests(TestCase):
    def test_registration_validates_password_and_forces_student(self):
        client = Client(enforce_csrf_checks=True)
        body = {"username": "Learner_02", "full_name": "Учень Тестовий", "password": PASSWORD,
                "role": "teacher", "is_staff": True, "is_superuser": True}
        self.assertEqual(post(client, "/api/register/", body).status_code, 403)
        csrf = get_token(client)
        invalid = post(client, "/api/register/", {**body, "password": "password1234"}, HTTP_X_CSRFTOKEN=csrf)
        self.assertIn("password", invalid.json()["fields"])
        self.assertEqual(User.objects.count(), 0)
        response = post(client, "/api/register/", body, HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["role"], "student")
        learner = User.objects.get(username="learner_02")
        self.assertTrue(learner.check_password(PASSWORD))
        self.assertFalse(learner.is_superuser or learner.is_staff)
        self.assertTrue(response.cookies[settings.SESSION_COOKIE_NAME]["httponly"])
        self.assertEqual(client.get("/api/groups/").status_code, 403)
        duplicate = post(self.client, "/api/register/", body)
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn("username", duplicate.json()["fields"])

    def test_login_csrf_logout_and_expired_session(self):
        person = teacher("teacher")
        client = Client(enforce_csrf_checks=True)
        body = {"username": "teacher", "password": PASSWORD, "client": "teacher"}
        csrf = get_token(client)
        anonymous_key = client.session.session_key
        self.assertEqual(post(client, "/api/login/", body, HTTP_X_CSRFTOKEN=csrf, HTTP_ORIGIN="https://evil.example").status_code, 403)
        self.assertEqual(post(client, "/api/login/", {**body, "client": "student"}, HTTP_X_CSRFTOKEN=csrf).status_code, 403)
        login = post(client, "/api/login/", body, HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(login.status_code, 200)
        self.assertNotEqual(client.session.session_key, anonymous_key)
        self.assertEqual(client.get("/api/session/").json()["user"]["id"], person.id)
        session_key = client.session.session_key
        self.assertEqual(post(client, "/api/logout/", HTTP_X_CSRFTOKEN=csrf).status_code, 403)
        self.assertEqual(post(client, "/api/logout/", HTTP_X_CSRFTOKEN=login.json()["csrf"]).status_code, 200)
        self.assertFalse(Session.objects.filter(pk=session_key).exists())
        self.assertEqual(client.get("/api/groups/").status_code, 401)
        client.force_login(person)
        Session.objects.filter(pk=client.session.session_key).update(expire_date=timezone.now() - timedelta(seconds=1))
        self.assertIsNone(client.get("/api/session/").json()["user"])
        self.assertEqual(client.get("/api/groups/").status_code, 401)

    def test_profile_only_changes_permitted_fields(self):
        learner = User.objects.create_user(username="learner", full_name="Ім’я", password=PASSWORD)
        self.client.force_login(learner)
        response = post(self.client, "/api/profile/", {"full_name": "Нове ім’я", "role": "teacher", "username": "other"})
        self.assertEqual(response.json()["user"]["full_name"], "Нове ім’я")
        learner.refresh_from_db()
        self.assertEqual((learner.role, learner.username), ("student", "learner"))

    def test_login_and_registration_rate_limits(self):
        body = {"username": "unlisted", "password": PASSWORD, "client": "teacher"}
        for _ in range(20):
            self.assertEqual(post(self.client, "/api/login/", body).status_code, 401)
        limited = post(self.client, "/api/login/", body)
        self.assertEqual(limited.status_code, 429)
        self.assertGreater(int(limited["Retry-After"]), 0)
        for _ in range(60):
            self.assertEqual(post(self.client, "/api/register/").status_code, 400)
        self.assertEqual(post(self.client, "/api/register/").status_code, 429)

    def test_health_is_non_cors_and_read_only(self):
        response = self.client.get("/api/health/", headers={"Origin": "https://other.example"})
        self.assertEqual(response.json(), {"service": "postup", "status": "ok", "version": "0.2.0"})
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertEqual(post(self.client, "/api/health/").status_code, 405)

    def test_teacher_reviews_current_version_once(self):
        path = "/api/review/"
        version = self.client.get("/api/health/").json()["version"]
        self.assertEqual(self.client.get(path).status_code, 401)
        learner = User.objects.create_user(username="learner", password=PASSWORD)
        self.client.force_login(learner)
        self.assertEqual(post(self.client, path, {"version": version}).status_code, 403)
        reviewer = teacher("reviewer")
        self.client.force_login(reviewer)
        self.assertEqual(self.client.get(path).json(), {"version": version, "approved": False})
        self.assertEqual(post(self.client, path, {"version": "0.0.0"}).status_code, 409)
        for _ in range(2):
            self.assertEqual(post(self.client, path, {"version": version}).json(), {"version": version, "approved": True})
        self.assertEqual(ReleaseApproval.objects.get().teacher, reviewer)
        self.client.force_login(teacher("another"))
        self.assertFalse(self.client.get(path).json()["approved"])


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class MembershipTests(TestCase):
    def setUp(self):
        self.owner = teacher("owner")
        self.other = teacher("other")
        self.learner = User.objects.create_user(username="learner", password=PASSWORD, full_name="Учень Тестовий")
        self.teacher = Client()
        self.teacher.force_login(self.owner)
        self.student = Client()
        self.student.force_login(self.learner)
        response = post(self.teacher, "/api/groups/", {"name": "9-А", "year": 2026, "description": "Демо"})
        self.assertEqual(response.status_code, 201)
        self.group = StudyGroup.objects.get(pk=response.json()["id"])
        self.path = f"/api/groups/{self.group.id}/"

    def issue(self):
        return self.teacher.put(self.path + "invitation/").json()["invitation"]["code"]

    def join(self, code, submit=True):
        return post(self.student, "/api/join/", {"code": code, "submit": submit})

    def test_membership_flow_and_removal_without_deleting_account(self):
        code = self.issue()
        preview = self.join(code, submit=False)
        self.assertEqual(preview.json(), {"group": {"name": "9-А", "year": 2026}, "status": None})
        self.assertFalse(Membership.objects.exists())
        self.assertEqual(self.join(code).json()["status"], "pending")
        self.assertEqual(self.join(code).json()["status"], "pending")
        item = Membership.objects.get()
        path = self.path + f"members/{item.id}/"
        self.assertEqual(self.teacher.get("/api/groups/").json()["groups"][0]["pending"], 1)
        self.assertEqual(patch(self.teacher, path, {"status": "approved"}).status_code, 200)
        self.assertEqual(patch(self.teacher, path, {"status": "approved"}).status_code, 200)
        self.assertEqual(self.student.get("/api/memberships/").json()["memberships"][0]["status"], "approved")
        self.assertEqual(patch(self.teacher, path, {"status": "removed"}).status_code, 200)
        self.assertTrue(User.objects.filter(pk=self.learner.id).exists())
        self.assertEqual(self.join(code).json()["status"], "pending")
        self.assertEqual(Membership.objects.count(), 1)

    def test_role_and_object_permissions(self):
        code = self.issue()
        self.join(code)
        item = Membership.objects.get()
        path = self.path + f"members/{item.id}/"
        stranger = Client()
        stranger.force_login(self.other)
        self.assertEqual(stranger.get("/api/groups/").json(), {"groups": []})
        self.assertEqual(stranger.get(self.path).status_code, 404)
        self.assertEqual(patch(stranger, self.path, {"archive": True}).status_code, 404)
        self.assertEqual(stranger.put(self.path + "invitation/").status_code, 404)
        self.assertEqual(patch(stranger, path, {"status": "approved"}).status_code, 404)
        self.assertEqual(self.student.get(self.path).status_code, 403)
        self.assertEqual(patch(self.student, path, {"status": "approved"}).status_code, 403)
        self.assertEqual(self.teacher.get("/api/memberships/").status_code, 403)

    def test_owner_can_update_group_fields(self):
        response = patch(self.teacher, self.path, {"name": " 9-Б ", "year": 2027, "description": "Новий опис"})
        self.assertEqual(response.status_code, 200)
        self.group.refresh_from_db()
        self.assertEqual((self.group.name, self.group.year, self.group.description), ("9-Б", 2027, "Новий опис"))

    def test_rotation_expiry_revoke_and_archive(self):
        first, second = self.issue(), self.issue()
        self.assertNotEqual(first, second)
        self.assertEqual(self.join(first).status_code, 404)
        self.group.refresh_from_db()
        self.group.invite_expires_at = timezone.now() - timedelta(seconds=1)
        self.group.save(update_fields=["invite_expires_at"])
        self.assertEqual(self.join(second).status_code, 404)
        third = self.issue()
        self.teacher.delete(self.path + "invitation/")
        self.assertEqual(self.join(third).status_code, 404)
        last = self.issue()
        self.join(last)
        item = Membership.objects.get()
        self.assertEqual(patch(self.teacher, self.path, {"archive": True}).status_code, 200)
        self.assertEqual(self.join(last).status_code, 404)
        self.assertEqual(self.teacher.put(self.path + "invitation/").status_code, 409)
        self.assertEqual(patch(self.teacher, self.path + f"members/{item.id}/", {"status": "approved"}).status_code, 409)
        self.assertEqual(Membership.objects.count(), 1)

    def test_rejected_does_not_resubmit_and_invite_throttles(self):
        code = self.issue()
        self.join(code)
        item = Membership.objects.get()
        patch(self.teacher, self.path + f"members/{item.id}/", {"status": "rejected"})
        self.assertEqual(self.join(code).json()["status"], "rejected")
        for _ in range(28):
            self.assertEqual(self.join("0" * 24).status_code, 404)
        self.assertEqual(self.join(code).status_code, 429)

    def test_student_can_join_multiple_groups_without_disclosing_roster(self):
        self.join(self.issue())
        first = self.group
        self.group = StudyGroup.objects.create(owner=self.owner, name="10-Б", year=2026)
        self.path = f"/api/groups/{self.group.id}/"
        self.join(self.issue())
        self.assertEqual(self.learner.memberships.count(), 2)
        self.assertEqual(self.student.get(f"/api/groups/{first.id}/").status_code, 403)
        payload = self.student.get("/api/memberships/").json()
        self.assertNotIn("full_name", json.dumps(payload))


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ConcurrentMembershipTests(TransactionTestCase):
    def test_two_simultaneous_approvals_are_idempotent(self):
        owner = teacher("owner")
        learner = User.objects.create_user(username="learner", password=PASSWORD)
        group = StudyGroup.objects.create(owner=owner, name="9-А", year=2026)
        item = Membership.objects.create(group=group, student=learner)
        clients = [Client(), Client()]
        for client in clients:
            client.force_login(owner)

        def approve(client):
            try:
                return patch(client, f"/api/groups/{group.id}/members/{item.id}/", {"status": "approved"}).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(approve, clients)), [200, 200])
        self.assertEqual(Membership.objects.filter(group=group, status="approved").count(), 1)

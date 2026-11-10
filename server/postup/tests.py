from django.test import SimpleTestCase


class HealthTests(SimpleTestCase):
    def test_demo_desktop_can_read_health(self):
        response = self.client.get("/api/health/", headers={"Origin": "http://tauri.localhost"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"service": "postup", "status": "ok", "version": "0.1.0"})
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://tauri.localhost")
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_foreign_origin_gets_no_cors_grant(self):
        response = self.client.get("/api/health/", headers={"Origin": "https://example.com"})
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_writes_are_rejected(self):
        self.assertEqual(self.client.post("/api/health/").status_code, 405)

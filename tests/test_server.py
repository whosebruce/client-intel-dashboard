"""Tests for server.py: static serving, /api/health, /api/summary.

Starts the real handler on a random local port. No network beyond 127.0.0.1.
Run with:  python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.summary_path = Path(cls.tmp.name) / "import_summary.json"
        cls.patch = mock.patch.object(server, "SUMMARY", cls.summary_path)
        cls.patch.start()
        cls.quiet = mock.patch.object(server.Handler, "log_message", lambda *a: None)
        cls.quiet.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.patch.stop()
        cls.quiet.stop()
        cls.tmp.cleanup()

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=5) as res:
            return res.status, res.headers, res.read()

    def test_health(self):
        status, _, body = self.get("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])

    def test_summary_missing_is_null(self):
        self.summary_path.unlink(missing_ok=True)
        _, _, body = self.get("/api/summary")
        self.assertEqual(json.loads(body), {"ok": True, "summary": None})

    def test_summary_returns_last_import_counts(self):
        self.summary_path.write_text(json.dumps({"records": 3, "records_without_coordinates_dropped": 1}), encoding="utf-8")
        _, _, body = self.get("/api/summary")
        self.assertEqual(json.loads(body)["summary"]["records"], 3)

    def test_serves_dashboard_modules_with_js_type(self):
        status, _, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b'type="module" src="js/main.js"', body)
        status, headers, _ = self.get("/js/main.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", headers["Content-Type"])

    def test_path_traversal_stays_inside_dashboard(self):
        _, _, body = self.get("/../server.py")
        self.assertNotIn(b"ThreadingHTTPServer", body)


if __name__ == "__main__":
    unittest.main()

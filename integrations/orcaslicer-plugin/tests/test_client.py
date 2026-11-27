from __future__ import annotations

import http.server
import json
import tempfile
import threading
import unittest
from pathlib import Path

import helpers


class FakeHandler(http.server.BaseHTTPRequestHandler):
    state: dict = {}

    def log_message(self, format: str, *args: object) -> None:
        pass

    def _send(self, status: int, body: bytes = b"", content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, status: int, payload: object) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"))

    def _route(self) -> str:
        prefix = self.state.get("prefix", "")
        if prefix:
            if not self.path.startswith(prefix):
                self._json(404, {"error": {"code": "NOT_FOUND", "message": "Not found"}})
                return ""
            return self.path[len(prefix) :]
        return self.path

    def _authorized(self) -> bool:
        expected = self.state.get("token")
        if not expected:
            return True
        authorization = self.headers.get("Authorization", "")
        if authorization == f"Bearer {expected}":
            return True
        self._json(401, {"error": {"code": "UNAUTHORIZED", "message": "A valid API token is required."}})
        return False

    def do_GET(self) -> None:
        path = self._route()
        if not path:
            return
        if path == "/api/health":
            if self.state.get("fail_health_once"):
                self.state["fail_health_once"] = False
                self._send(429, b'{"error":{"code":"RATE_LIMITED","message":"slow down"}}')
                return
            self._json(200, {"status": "ok", "version": "9.9.9", "runner": {}})
            return
        if not self._authorized():
            return
        if path == "/api/printers":
            self._json(200, {"printers": [{"id": "ad5x", "name": "FlashForge AD5X"}], "maxUploadMb": 100})
            return
        if path == "/api/conversions/job-1":
            self._json(200, {"id": "job-1", "status": "completed", "progress": 100, "download": {"filename": "model_ad5x.3mf"}})
            return
        if path == "/api/conversions/job-1/download":
            body = self.state.get("download", b"converted")
            self._send(200, body, "application/octet-stream")
            return
        if path == "/api/uploads/upload-1/thumbnail":
            self._send(200, b"\x89PNG\r\n\x1a\nmock", "image/png")
            return
        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Not found"}})

    def do_POST(self) -> None:
        path = self._route()
        if not path:
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if path == "/api/uploads":
            if not self._authorized():
                return
            self.state["upload_body"] = body
            self.state["upload_headers"] = dict(self.headers)
            self._json(
                201,
                {
                    "uploadId": "upload-1",
                    "analysis": {"fileName": "project.3mf", "usedColorCount": 1, "colors": []},
                    "hasThumbnail": True,
                },
            )
            return
        if path == "/api/conversions":
            if not self._authorized():
                return
            self.state["conversion_payload"] = json.loads(body.decode("utf-8"))
            self._json(202, {"id": "job-1", "status": "queued", "progress": 0})
            return
        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Not found"}})

    def do_DELETE(self) -> None:
        path = self._route()
        if not path:
            return
        if not self._authorized():
            return
        if path == "/api/conversions/job-1":
            self.state["deleted"] = True
            self._send(204)
            return
        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Not found"}})


class ClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.state = FakeHandler.state
        cls.state.clear()
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self) -> None:
        self.plugin, _ = helpers.load_plugin()
        self.state.clear()
        self.state["fail_health_once"] = False
        self.state["prefix"] = ""
        self.state["deleted"] = False

    def client(self, token: str = "") -> object:
        return self.plugin.ConverterClient(self.base_url, token, timeout=5)

    def test_health_and_printers(self) -> None:
        client = self.client()
        self.assertEqual(client.health()["version"], "9.9.9")
        printers = client.printers()
        self.assertEqual(printers["printers"][0]["id"], "ad5x")

    def test_authentication_and_error_parsing(self) -> None:
        self.state["token"] = "secret-token"
        client = self.client("wrong")
        with self.assertRaises(self.plugin.ConverterError) as caught:
            client.printers()
        self.assertEqual(caught.exception.status, 401)
        self.assertEqual(caught.exception.code, "UNAUTHORIZED")

        authorized = self.client("secret-token")
        self.assertEqual(authorized.printers()["maxUploadMb"], 100)

    def test_upload_multipart_and_progress(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.3mf"
            path.write_bytes(b"hello-project")
            progress: list[tuple[int, int]] = []
            uploaded: list[bool] = []
            result = self.client().upload(
                path,
                "project.3mf",
                on_progress=lambda sent, total: progress.append((sent, total)),
                on_uploaded=lambda: uploaded.append(True),
            )
            self.assertEqual(result["uploadId"], "upload-1")
            body = self.state["upload_body"]
            self.assertIn(b'name="file"; filename="project.3mf"', body)
            self.assertIn(b"hello-project", body)
            self.assertTrue(progress)
            self.assertEqual(progress[0], (0, 13))
            self.assertEqual(progress[-1], (13, 13))
            self.assertEqual(uploaded, [True])
            self.assertEqual(self.state["upload_headers"]["Accept-Encoding"], "identity")

    def test_conversion_download_thumbnail_and_delete(self) -> None:
        client = self.client()
        job = client.create_conversion(
            "upload-1",
            {
                "printerId": "ad5x",
                "nozzle": "0.4",
                "processName": None,
                "preserveTemperatures": True,
            },
        )
        self.assertEqual(job["id"], "job-1")
        self.assertNotIn("processName", self.state["conversion_payload"])
        status = client.conversion("job-1")
        self.assertEqual(status["status"], "completed")
        image, mime = client.thumbnail("upload-1")
        self.assertEqual(mime, "image/png")
        self.assertTrue(image.startswith(b"\x89PNG"))
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "out.3mf"
            client.download("job-1", destination)
            self.assertEqual(destination.read_bytes(), b"converted")
            self.assertFalse(destination.with_name("out.3mf.part").exists())
        client.delete_conversion("job-1")
        self.assertTrue(self.state["deleted"])

    def test_retry_on_rate_limit(self) -> None:
        self.state["fail_health_once"] = True
        client = self.client()
        client._sleep = lambda _: None
        self.assertEqual(client.health(retries=1)["version"], "9.9.9")

    def test_base_path(self) -> None:
        self.state["prefix"] = "/ff3mf"
        client = self.plugin.ConverterClient(f"{self.base_url}/ff3mf", timeout=5)
        self.assertEqual(client.health()["status"], "ok")
        self.assertEqual(client.printers()["printers"][0]["id"], "ad5x")

    def test_network_error(self) -> None:
        client = self.plugin.ConverterClient("http://127.0.0.1:1", timeout=0.2)
        with self.assertRaises(self.plugin.ConverterError) as caught:
            client.health(retries=0)
        self.assertEqual(caught.exception.code, "NETWORK_ERROR")

    def test_network_error_marks_permission_failures(self) -> None:
        client = self.plugin.ConverterClient("http://127.0.0.1:1", timeout=0.2)
        error = client._network_error(PermissionError())
        self.assertEqual(error.code, "NETWORK_ERROR")
        self.assertTrue(any("permission" in detail.lower() for detail in error.details))


if __name__ == "__main__":
    unittest.main()

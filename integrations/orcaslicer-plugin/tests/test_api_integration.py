from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request
import zipfile
from pathlib import Path

import helpers


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@unittest.skipUnless(shutil.which("node"), "Node.js is required for the API integration test")
class ApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server_entry = helpers.REPO_ROOT / "apps" / "api" / "dist" / "server.js"
        if not cls.server_entry.is_file():
            raise unittest.SkipTest("Build the workspaces before running the API integration test")
        cls.plugin, _ = helpers.load_plugin()
        cls.temp = tempfile.TemporaryDirectory(prefix="ff3mf-api-test-")
        cls.data_dir = Path(cls.temp.name) / "data"
        cls.log_path = Path(cls.temp.name) / "api.log"
        cls.port = free_port()
        env = {
            **os.environ,
            "PORT": str(cls.port),
            "HOST": "127.0.0.1",
            "DATA_DIR": str(cls.data_dir),
            "WEB_DIR": str(helpers.REPO_ROOT / "apps" / "web" / "dist"),
            "APP_VERSION": "integration",
            "LOG_LEVEL": "error",
            "RATE_LIMIT_MAX": "1000",
            "MAX_UPLOAD_MB": "100",
            "MAX_CONCURRENT_JOBS": "1",
            "CONVERSION_TIMEOUT_SECONDS": "120",
            "JOB_TTL_MINUTES": "10",
        }
        with cls.log_path.open("wb") as log:
            cls.process = subprocess.Popen(
                ["node", str(cls.server_entry)],
                cwd=helpers.REPO_ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if cls.process.poll() is not None:
                    raise AssertionError(cls._log_text())
                try:
                    with urllib.request.urlopen(f"{cls.base_url}/api/health", timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(0.25)
            else:
                raise AssertionError(f"API did not start:\n{cls._log_text()}")
        except Exception:
            cls.process.terminate()
            cls.process.wait(timeout=5)
            cls.temp.cleanup()
            raise

    @classmethod
    def tearDownClass(cls) -> None:
        if getattr(cls, "process", None) is not None:
            cls.process.terminate()
            try:
                cls.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.process.kill()
                cls.process.wait(timeout=5)
        cls.temp.cleanup()

    @classmethod
    def _log_text(cls) -> str:
        try:
            return cls.log_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""

    def test_upload_exposes_plate_previews(self) -> None:
        client = self.plugin.ConverterClient(self.base_url, timeout=30)
        upload = client.upload(helpers.MULTI_PREVIEW_FIXTURE, "multi-plate-preview.3mf")
        plates = self.plugin.FF3MFWorkflow._preview_plates(upload)
        self.assertGreaterEqual(len(plates), 2)
        for plate in plates:
            image, mime = client.thumbnail(upload["uploadId"], plate)
            self.assertGreater(len(image), 0, f"plate {plate} returned no image")
            self.assertIn(mime, {"image/png", "image/jpeg"})

    def test_upload_convert_download(self) -> None:
        client = self.plugin.ConverterClient(self.base_url, timeout=30)
        printers = client.printers()
        ad5x = next((printer for printer in printers["printers"] if printer["id"] == "ad5x"), None)
        self.assertIsNotNone(ad5x)
        nozzle = next(
            (item for item in ad5x["nozzles"] if str(item["diameter"]) == "0.4"),
            None,
        )
        self.assertIsNotNone(nozzle)

        upload = client.upload(helpers.FIXTURE_PATH, "four-color.3mf")
        self.assertTrue(upload["uploadId"])
        self.assertIn("analysis", upload)

        job = client.create_conversion(
            upload["uploadId"],
            {
                "printerId": "ad5x",
                "nozzle": "0.4",
                "layout": "center",
                "preserveTemperatures": True,
                "keepAllColors": False,
            },
        )
        job_id = job["id"]
        deadline = time.monotonic() + 120
        status = {}
        while time.monotonic() < deadline:
            status = client.conversion(job_id)
            if status.get("status") in {"completed", "failed"}:
                break
            time.sleep(0.5)
        self.assertEqual(status.get("status"), "completed", status.get("error"))

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "converted.3mf"
            client.download(job_id, destination)
            self.assertTrue(destination.is_file())
            self.plugin.inspect_3mf(destination, require_settings=True)
            with zipfile.ZipFile(destination) as archive:
                settings = json.loads(archive.read("Metadata/project_settings.config"))
            self.assertTrue(str(settings.get("printer_settings_id", "")).startswith("Flashforge AD5X"))
            self.assertIn("AD5X", str(settings.get("printer_model", "")))
            self.assertTrue(settings.get("filament_settings_id"))

        client.delete_conversion(job_id)


if __name__ == "__main__":
    unittest.main()

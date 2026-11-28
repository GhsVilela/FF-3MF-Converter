from __future__ import annotations

import shutil
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from typing import Any

import helpers


class FakeApi:
    def __init__(self) -> None:
        self.upload_result = {
            "uploadId": "11111111-1111-4111-8111-111111111111",
            "analysis": {
                "fileName": "four-color.3mf",
                "usedColorCount": 2,
                "colors": [
                    {"slot": 1, "used": True, "color": "#ff0000", "type": "PLA", "name": "Red"},
                    {"slot": 2, "used": True, "color": "#00ff00", "type": "PLA", "name": "Green"},
                ],
                "warnings": [],
            },
            "hasThumbnail": True,
            "thumbnails": [{"plate": 1}, {"plate": 2}],
        }
        self.thumbnail_calls: list[int | None] = []
        self.statuses = [
            {"status": "converting", "stage": "rewriting", "progress": 50},
            {
                "status": "completed",
                "progress": 100,
                "download": {"filename": "four-color_ad5x.3mf"},
                "report": {"stats": {"settingsKept": 2}, "warnings": [], "filaments": []},
            },
        ]
        self.created: list[tuple[str, dict[str, Any]]] = []
        self.deleted: list[str] = []
        self.upload_gate: threading.Event | None = None
        self.upload_started = threading.Event()

    def upload(
        self,
        path: Path,
        filename: str,
        on_progress=None,
        on_uploaded=None,
    ) -> dict[str, Any]:
        self.upload_started.set()
        if self.upload_gate is not None:
            self.upload_gate.wait(timeout=5)
        if on_progress:
            size = path.stat().st_size
            on_progress(0, size)
            on_progress(size, size)
        if on_uploaded:
            on_uploaded()
        return self.upload_result

    def thumbnail(self, upload_id: str, plate: int | None = None):
        self.thumbnail_calls.append(plate)
        return f"\x89PNG\r\n\x1a\nplate-{plate or 1}".encode(), "image/png"

    def create_conversion(self, upload_id: str, options: dict[str, Any]) -> dict[str, Any]:
        self.created.append((upload_id, options))
        return {"id": "job-1"}

    def conversion(self, job_id: str) -> dict[str, Any]:
        return self.statuses.pop(0) if self.statuses else {"status": "converting", "progress": 60}

    def download(self, job_id: str, destination: Path, on_progress=None) -> None:
        helpers.make_project_3mf(destination)
        if on_progress:
            on_progress(10, 10)

    def delete_conversion(self, job_id: str) -> None:
        self.deleted.append(job_id)


class FakeProbeClient:
    def __init__(self, error_factory, failures: int) -> None:
        self.error_factory = error_factory
        self.failures = failures
        self.health_calls = 0

    def health(self, **kwargs: Any) -> dict[str, Any]:
        self.health_calls += 1
        if self.health_calls <= self.failures:
            raise self.error_factory()
        return {"version": "0.5.1"}

    def printers(self, **kwargs: Any) -> dict[str, Any]:
        return {
            "printers": [{"id": "ad5x", "name": "FlashForge AD5X", "maxColors": 4, "nozzles": []}],
            "maxUploadMb": 512,
        }


class ProbeRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plugin, self.fake = helpers.load_plugin()
        self.page = self.plugin.FlashForgePage()
        self.page._ensure_state()
        self.plugin.PROBE_PERMISSION_RETRY_DELAYS = (0.01, 0.01, 0.01)

    def wait_for_status(self, status: str, timeout: float = 5) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.page._connection.get("status") == status:
                return
            time.sleep(0.01)
        self.fail(f"connection did not become {status}: {self.page._connection}")

    def test_probe_retries_until_network_permission_is_granted(self) -> None:
        client = FakeProbeClient(
            lambda: self.plugin.ConverterError(
                "NETWORK_ERROR",
                "Could not reach the FF-3MF instance.",
                ["audit permission required"],
            ),
            failures=2,
        )
        self.page._client = client
        self.page._probe_async()
        self.wait_for_status("online")
        self.assertEqual(client.health_calls, 3)
        self.assertEqual(self.page._printers["printers"][0]["id"], "ad5x")

    def test_probe_stops_after_the_permission_retry_window(self) -> None:
        client = FakeProbeClient(
            lambda: self.plugin.ConverterError(
                "NETWORK_ERROR",
                "Could not reach the FF-3MF instance.",
                ["audit permission required"],
            ),
            failures=10,
        )
        self.page._client = client
        self.page._probe_async()
        self.wait_for_status("offline")
        self.assertEqual(client.health_calls, 4)
        self.assertIn("permission", self.page._connection["message"].lower())

    def test_probe_retries_once_for_other_network_errors(self) -> None:
        client = FakeProbeClient(
            lambda: self.plugin.ConverterError(
                "NETWORK_ERROR",
                "Could not reach the FF-3MF instance.",
                ["Connection refused"],
            ),
            failures=2,
        )
        self.page._client = client
        self.page._probe_async()
        self.wait_for_status("offline")
        self.assertEqual(client.health_calls, 2)
        self.assertEqual(
            self.page._connection["message"],
            "Could not reach the FF-3MF instance.",
        )


class PageFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plugin, self.fake = helpers.load_plugin()
        self.temp = tempfile.TemporaryDirectory()
        self.project_path = Path(self.temp.name) / "four-color.3mf"
        shutil.copyfile(helpers.FIXTURE_PATH, self.project_path)
        self.fake["plater"].path = str(self.project_path)
        self.fake["plater"].dirty = False
        self.page = self.plugin.FlashForgePage()
        self.page._ensure_state()
        self.page._probe_async = lambda: None
        self.page._printers = {
            "printers": [
                {
                    "id": "ad5x",
                    "name": "FlashForge AD5X",
                    "maxColors": 4,
                    "nozzles": [
                        {
                            "diameter": "0.4",
                            "processes": [{"name": "0.20mm Standard @FF AD5X", "layerHeight": "0.2"}],
                        }
                    ],
                }
            ],
            "maxUploadMb": 100,
        }
        self.api = FakeApi()
        self.page._client = self.api

    def tearDown(self) -> None:
        self.temp.cleanup()

    def wait_until_idle(self, timeout: float = 10) -> None:
        deadline = time.monotonic() + timeout
        while self.page._busy and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertFalse(self.page._busy, "the plugin worker did not finish")

    def test_analyze_then_convert_through_the_page_handlers(self) -> None:
        self.page._handle_analyze()
        self.wait_until_idle()
        self.assertIsNotNone(self.page._analysis)
        self.assertEqual(self.page._analysis["uploadId"], self.api.upload_result["uploadId"])

        self.page._handle_convert(
            {
                "target": {"printerId": "ad5x", "nozzle": "0.4", "processName": ""},
                "options": {
                    "colorMapping": {"1": 1, "2": 2},
                    "preserveTemperatures": True,
                    "keepAllColors": False,
                    "layout": "center",
                },
            }
        )
        self.wait_until_idle()
        self.assertIsNone(self.page._last_error)
        self.assertIsNotNone(self.page._last_result)
        output = Path(self.page._last_result["outputPath"])
        self.assertTrue(output.is_file())
        self.assertTrue(Path(self.page._last_result["reportPath"]).is_file())
        self.assertEqual(self.api.deleted, ["job-1"])
        snapshot = self.fake["messages"][-1]
        self.assertEqual(snapshot["type"], "snapshot")
        self.assertIsNotNone(snapshot["result"])
        self.assertFalse(snapshot["busy"])
        self.assertNotIn("token", str(snapshot).lower())


    def test_preview_request_returns_the_requested_plate_and_uses_cache(self) -> None:
        self.page._handle_analyze()
        self.wait_until_idle()
        upload_id = self.page._analysis["uploadId"]
        self.assertEqual(self.page._analysis["previewPlates"], [1, 2])

        self.page._handle_preview_request({"uploadId": upload_id, "plate": 2})
        deadline = time.monotonic() + 5
        preview = None
        while time.monotonic() < deadline:
            preview = next(
                (
                    message
                    for message in self.fake["messages"]
                    if message.get("type") == "preview" and message.get("plate") == 2
                ),
                None,
            )
            if preview:
                break
            time.sleep(0.01)
        self.assertIsNotNone(preview)
        self.assertTrue(preview["image"].startswith("data:image/png;base64,"))
        self.assertEqual(self.api.thumbnail_calls, [2])

        self.page._handle_preview_request({"uploadId": upload_id, "plate": 2})
        self.assertEqual(self.api.thumbnail_calls, [2])

    def test_project_edit_clears_current_project_analysis(self) -> None:
        self.page._handle_analyze()
        self.wait_until_idle()
        self.assertIsNotNone(self.page._analysis)
        self.page.on_lifecycle_event(
            types.SimpleNamespace(name="ObjectChanged"),
            types.SimpleNamespace(),
        )
        self.assertIsNone(self.page._analysis)

    def test_edit_during_analysis_discards_the_stale_result(self) -> None:
        self.api.upload_gate = threading.Event()
        self.page._handle_analyze()
        self.assertTrue(self.api.upload_started.wait(timeout=5))
        self.page.on_lifecycle_event(
            types.SimpleNamespace(name="ObjectChanged"),
            types.SimpleNamespace(),
        )
        self.api.upload_gate.set()
        self.wait_until_idle()
        self.assertIsNone(self.page._analysis)
        self.assertEqual(self.page._last_error["code"], "PROJECT_CHANGED")


if __name__ == "__main__":
    unittest.main()

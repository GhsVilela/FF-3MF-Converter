from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Callable

import helpers


class FakeClient:
    def __init__(self) -> None:
        self.upload_path: Path | None = None
        self.upload_name = ""
        self.upload_result: dict[str, Any] = {
            "uploadId": "upload-1",
            "analysis": {"colors": [{"slot": 1, "used": True, "color": "#ff0000"}], "usedColorCount": 1},
            "hasThumbnail": True,
            "thumbnails": [{"plate": 3}, {"plate": 1}, {"plate": 2}],
        }
        self.thumbnail_result = (b"\x89PNG\r\n\x1a\nx", "image/png")
        self.thumbnail_calls: list[int | None] = []
        self.created: list[tuple[str, dict[str, Any]]] = []
        self.statuses: list[dict[str, Any]] = []
        self.download_writes_output = True
        self.download_calls: list[tuple[str, Path]] = []
        self.deleted: list[str] = []
        self.on_conversion: Callable[[], None] | None = None

    def upload(self, path: Path, filename: str, on_progress=None, on_uploaded=None) -> dict[str, Any]:
        self.upload_path = path
        self.upload_name = filename
        if on_progress:
            size = path.stat().st_size
            on_progress(0, size)
            on_progress(size, size)
        if on_uploaded:
            on_uploaded()
        return self.upload_result

    def thumbnail(self, upload_id: str, plate: int | None = None):
        self.thumbnail_calls.append(plate)
        return self.thumbnail_result

    def create_conversion(self, upload_id: str, options: dict[str, Any]) -> dict[str, Any]:
        self.created.append((upload_id, options))
        return {"id": "job-1"}

    def conversion(self, job_id: str) -> dict[str, Any]:
        if self.on_conversion:
            self.on_conversion()
        if self.statuses:
            return self.statuses.pop(0)
        return {"status": "converting", "stage": "rewriting", "progress": 50}

    def download(self, job_id: str, destination: Path, on_progress=None) -> None:
        self.download_calls.append((job_id, destination))
        if on_progress:
            on_progress(10, 10)
        if self.download_writes_output:
            helpers.make_project_3mf(destination)
        else:
            helpers.make_zip_without_settings(destination)

    def delete_conversion(self, job_id: str) -> None:
        self.deleted.append(job_id)


class WorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plugin, self.fake = helpers.load_plugin()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.messages: list[dict[str, Any]] = []
        self.client = FakeClient()
        self.workflow = self.plugin.FF3MFWorkflow(
            self.client,
            self.root / "outputs",
            self.messages.append,
            poll_interval=0.001,
            timeout=30,
            sleep=lambda _: None,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_analyze_returns_preview_plates_and_cleans_temporary_source(self) -> None:
        source_path = self.root / "export.3mf"
        helpers.make_project_3mf(source_path)
        size = source_path.stat().st_size
        source = self.plugin.SourceFile(source_path, "My model", True, "export")
        result = self.workflow.analyze(source)
        self.assertEqual(result["uploadId"], "upload-1")
        self.assertEqual(result["previewPlates"], [1, 2, 3])
        self.assertIsNone(result["thumbnail"])
        self.assertEqual(self.client.thumbnail_calls, [])
        self.assertEqual(self.client.upload_name, "My_model.3mf")
        self.assertFalse(source_path.exists())
        progress = [message["progress"] for message in self.messages if message["type"] == "progress"]
        self.assertTrue(
            any(
                item["phase"] == "uploading"
                and item["percent"] == 100
                and item["completedBytes"] == size
                and item["totalBytes"] == size
                for item in progress
            )
        )
        self.assertTrue(any(item["phase"] == "analysing" and item.get("indeterminate") for item in progress))

    def test_analyze_keeps_saved_source(self) -> None:
        source_path = self.root / "saved.3mf"
        helpers.make_project_3mf(source_path)
        source = self.plugin.SourceFile(source_path, "saved", False, "saved")
        self.workflow.analyze(source)
        self.assertTrue(source_path.exists())

    def test_analyze_rejects_oversized_upload(self) -> None:
        source_path = self.root / "large.3mf"
        helpers.make_project_3mf(source_path)
        source = self.plugin.SourceFile(source_path, "large", False, "saved")
        with self.assertRaises(self.plugin.PluginError) as caught:
            self.workflow.analyze(source, max_upload_mb=0.000001)
        self.assertEqual(caught.exception.code, "UPLOAD_TOO_LARGE")

    def test_convert_downloads_report_and_cleans_job(self) -> None:
        self.client.statuses = [
            {"status": "converting", "stage": "analysing", "progress": 2},
            {"status": "converting", "stage": "rewriting", "progress": 50},
            {
                "status": "completed",
                "progress": 100,
                "download": {"filename": "my_model_ad5x.3mf"},
                "report": {"stats": {"settingsKept": 3}, "warnings": []},
            },
        ]
        result = self.workflow.convert(
            "upload-1",
            {"printerId": "ad5x", "nozzle": "0.4", "layout": "center"},
            "my model",
        )
        self.assertEqual(result["outputName"], "my_model_ad5x.3mf")
        self.assertTrue(Path(result["outputPath"]).exists())
        self.assertTrue(Path(result["reportPath"]).exists())
        self.assertEqual(self.client.deleted, ["job-1"])
        self.assertIn("report", result)
        stages = [
            message["progress"]["stage"]
            for message in self.messages
            if message["type"] == "progress"
        ]
        self.assertIn("Preparing the conversion", stages)
        self.assertNotIn("Analysing the source project", stages)

    def test_convert_rejects_invalid_output(self) -> None:
        self.client.download_writes_output = False
        self.client.statuses = [
            {
                "status": "completed",
                "progress": 100,
                "download": {"filename": "bad.3mf"},
            }
        ]
        with self.assertRaises(self.plugin.PluginError):
            self.workflow.convert("upload-1", {"printerId": "ad5x"}, "bad")
        self.assertFalse((self.root / "outputs" / "bad.3mf").exists())

    def test_convert_reports_api_failure(self) -> None:
        self.client.statuses = [
            {
                "status": "failed",
                "error": {"code": "CONVERSION_FAILED", "message": "bad project", "details": ["x"]},
            }
        ]
        with self.assertRaises(self.plugin.ConverterError) as caught:
            self.workflow.convert("upload-1", {"printerId": "ad5x"}, "bad")
        self.assertEqual(caught.exception.code, "CONVERSION_FAILED")
        self.assertEqual(caught.exception.details, ["x"])

    def test_convert_can_be_cancelled(self) -> None:
        self.client.on_conversion = lambda: self.workflow.cancel_event.set()
        self.client.statuses = [{"status": "converting", "stage": "rewriting", "progress": 50}]
        with self.assertRaises(self.plugin.PluginError) as caught:
            self.workflow.convert("upload-1", {"printerId": "ad5x"}, "bad")
        self.assertEqual(caught.exception.code, "CANCELLED")
        self.assertEqual(self.client.deleted, ["job-1"])

    def test_convert_times_out(self) -> None:
        self.workflow.timeout = 0
        self.client.statuses = [{"status": "converting", "progress": 1}]
        started = time.monotonic()
        with self.assertRaises(self.plugin.PluginError) as caught:
            self.workflow.convert("upload-1", {"printerId": "ad5x"}, "bad")
        self.assertEqual(caught.exception.code, "CONVERSION_TIMEOUT")
        self.assertLess(time.monotonic() - started, 2)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import base64
import json
import tempfile
import time
import types
import unittest
import zipfile
from pathlib import Path

import helpers
from test_page_flow import FakeApi


class FileSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plugin, self.fake = helpers.load_plugin()
        self.temp = tempfile.TemporaryDirectory()
        self.source_path = Path(self.temp.name) / "selected.3mf"
        helpers.make_project_3mf(self.source_path)
        with zipfile.ZipFile(self.source_path, "a") as archive:
            archive.writestr("padding.bin", b"x" * (self.plugin.FILE_CHUNK_BYTES + 1024))
        self.bytes = self.source_path.read_bytes()
        self.page = self.plugin.FlashForgePage()
        self.page._ensure_state()
        self.page._probe_async = lambda: None

    def tearDown(self) -> None:
        self.page._cancel_transfer()
        self.page._delete_selected_file()
        self.temp.cleanup()

    def wait_until_idle(self, timeout: float = 10) -> None:
        deadline = time.monotonic() + timeout
        while self.page._busy and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertFalse(self.page._busy, "the plugin worker did not finish")

    def begin_transfer(self) -> tuple[str, int]:
        transfer_id = "transfer-12345678"
        total_chunks = (len(self.bytes) + self.plugin.FILE_CHUNK_BYTES - 1) // self.plugin.FILE_CHUNK_BYTES
        self.page._handle_set_source({"source": "selected"})
        self.page._handle_file_begin(
            {
                "transferId": transfer_id,
                "name": "My selected project.3mf",
                "size": len(self.bytes),
                "totalChunks": total_chunks,
            }
        )
        return transfer_id, total_chunks

    def send_chunks(self, transfer_id: str, total_chunks: int) -> None:
        for index in range(total_chunks):
            start = index * self.plugin.FILE_CHUNK_BYTES
            end = min(len(self.bytes), start + self.plugin.FILE_CHUNK_BYTES)
            self.page._handle_file_chunk(
                {
                    "transferId": transfer_id,
                    "index": index,
                    "data": base64.b64encode(self.bytes[start:end]).decode("ascii"),
                }
            )

    def test_transfer_selected_file_in_chunks(self) -> None:
        transfer_id, total_chunks = self.begin_transfer()
        self.assertEqual(self.page._source_mode, "selected")
        self.assertIsNotNone(self.page._transfer)
        self.send_chunks(transfer_id, total_chunks)
        self.assertIsNone(self.page._transfer)
        self.assertIsNotNone(self.page._selected_file)
        selected_path = Path(self.page._selected_file["path"])
        self.assertTrue(selected_path.is_file())
        self.assertEqual(selected_path.read_bytes(), self.bytes)
        self.assertEqual(self.page._selected_file["name"], "My selected project.3mf")
        snapshot = self.page._snapshot()
        self.assertEqual(snapshot["source"]["mode"], "selected")
        self.assertEqual(snapshot["source"]["selectedFile"]["name"], "My selected project.3mf")
        self.assertNotIn(str(selected_path), json.dumps(snapshot))
        message_types = [message.get("type") for message in self.fake["messages"]]
        self.assertIn("file-started", message_types)
        self.assertIn("file-complete", message_types)

    def test_out_of_order_chunk_aborts_transfer(self) -> None:
        transfer_id, total_chunks = self.begin_transfer()
        self.assertGreaterEqual(total_chunks, 1)
        self.page._handle_file_chunk(
            {
                "transferId": transfer_id,
                "index": 1,
                "data": base64.b64encode(b"x").decode("ascii"),
            }
        )
        self.assertIsNone(self.page._transfer)
        self.assertIsNone(self.page._selected_file)
        message_types = [message.get("type") for message in self.fake["messages"]]
        self.assertIn("file-error", message_types)

    def test_bad_extension_is_rejected(self) -> None:
        self.page._handle_file_begin(
            {
                "transferId": "transfer-bad-name",
                "name": "model.stl",
                "size": 10,
                "totalChunks": 1,
            }
        )
        self.assertIsNone(self.page._transfer)
        self.assertIsNone(self.page._selected_file)
        self.assertEqual(self.page._source_mode, "current")

    def test_selected_analysis_survives_project_edits(self) -> None:
        transfer_id, total_chunks = self.begin_transfer()
        self.send_chunks(transfer_id, total_chunks)
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
        self.page._client = FakeApi()
        self.page._handle_analyze()
        self.wait_until_idle()
        self.assertIsNotNone(self.page._analysis)
        self.assertEqual(self.page._analysis_source_mode, "selected")
        self.assertEqual(self.page._analysis["sourceMode"], "selected")

        self.page.on_lifecycle_event(
            types.SimpleNamespace(name="ObjectChanged"),
            types.SimpleNamespace(),
        )
        self.assertIsNotNone(self.page._analysis, "selected-file analysis must not depend on project edits")

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
        self.assertTrue(Path(self.page._last_result["outputPath"]).is_file())

        selected_path = Path(self.page._selected_file["path"])
        self.page._handle_clear_selected_file()
        self.assertFalse(selected_path.exists())
        self.assertIsNone(self.page._selected_file)

        self.page._handle_set_source({"source": "current"})
        self.assertIsNone(self.page._analysis)
        self.assertEqual(self.page._source_mode, "current")
        self.assertIsNone(self.page._selected_file)


if __name__ == "__main__":
    unittest.main()

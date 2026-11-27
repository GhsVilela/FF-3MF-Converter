from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import helpers


class PluginContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plugin, self.fake = helpers.load_plugin()
        self.fake["plugin_class"]().register_capabilities()

    def test_registers_one_package_and_pages_capability(self) -> None:
        self.assertIsNotNone(self.fake["plugin_class"])
        self.assertTrue(issubclass(self.fake["plugin_class"], self.plugin.orca.base))
        self.assertEqual(len(self.fake["capabilities"]), 1)
        capability = self.fake["capabilities"][0]
        self.assertTrue(issubclass(capability, self.plugin.orca.pages.PagesPluginCapabilityBase))
        instance = capability()
        self.assertEqual(instance.get_name(), "FF-3MF")
        self.assertNotIn(";", instance.get_name())
        self.assertIn("test panel", instance.get_ui())

    def test_requests_only_the_worker_thread_at_activation(self) -> None:
        permissions = self.fake["permissions"]
        self.assertIsNotNone(permissions)
        self.assertTrue(permissions["threading"])
        self.assertNotIn("network_http", permissions)

    def test_snapshot_never_includes_token(self) -> None:
        capability = self.plugin.FlashForgePage()
        capability._ensure_state()
        capability._token_store.write("super-secret-token")
        capability._token = "super-secret-token"
        snapshot = capability._snapshot()
        serialized = json.dumps(snapshot).lower()
        self.assertNotIn("super-secret-token", serialized)
        self.assertTrue(snapshot["auth"]["configured"])
        self.assertIn("apiUrl", snapshot["config"])
        self.assertNotIn("apiToken", json.dumps(snapshot["config"]).lower())

    def test_prepare_source_uses_saved_clean_project(self) -> None:
        capability = self.plugin.FlashForgePage()
        capability._ensure_state()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "saved.3mf"
            helpers.make_project_3mf(path)
            self.fake["plater"].path = str(path)
            self.fake["plater"].dirty = False
            prepared = capability._prepare_source()
            self.assertEqual(prepared.source.mode, "saved")
            self.assertFalse(prepared.source.temporary)
            self.assertEqual(prepared.source.path, path)

    def test_prepare_source_exports_dirty_project(self) -> None:
        capability = self.plugin.FlashForgePage()
        capability._ensure_state()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "saved.3mf"
            helpers.make_project_3mf(path)
            self.fake["plater"].path = str(path)
            self.fake["plater"].dirty = True
            prepared = capability._prepare_source()
            self.assertEqual(prepared.source.mode, "export")
            self.assertTrue(prepared.source.temporary)
            self.assertTrue(prepared.source.path.exists())
            self.assertEqual(prepared.source.display_name, "saved")
            prepared.source.path.unlink()

    def test_ready_sends_a_snapshot_and_skips_live_network_in_test(self) -> None:
        capability = self.plugin.FlashForgePage()
        capability._probe_async = lambda: None
        capability._handle_ready()
        messages = self.fake["messages"]
        self.assertTrue(messages)
        self.assertEqual(messages[-1]["type"], "snapshot")
        self.assertIn("config", messages[-1])
        self.assertNotIn("token", json.dumps(messages[-1]).lower())

    def test_save_settings_stores_token_outside_config(self) -> None:
        capability = self.plugin.FlashForgePage()
        capability._ensure_state()
        capability._probe_async = lambda: None
        capability._handle_save_settings(
            {
                "config": {"apiUrl": "http://127.0.0.1:9000", "outputDir": ""},
                "token": {"action": "set", "value": "abc123"},
            }
        )
        self.assertEqual(capability._config.api_url, "http://127.0.0.1:9000")
        self.assertEqual(capability._token_store.read(), "abc123")
        stored_config = json.loads(capability.get_config())
        self.assertNotIn("token", json.dumps(stored_config).lower())
        self.assertNotIn("abc123", json.dumps(stored_config))

    def test_clear_token_does_not_require_a_valid_url(self) -> None:
        capability = self.plugin.FlashForgePage()
        capability._ensure_state()
        capability._probe_async = lambda: None
        capability._token_store.write("abc123")
        capability._token = "abc123"
        capability._handle_clear_token()
        self.assertEqual(capability._token, "")
        self.assertEqual(capability._token_store.read(), "")

    def test_validate_options_builds_converter_payload(self) -> None:
        capability = self.plugin.FlashForgePage()
        capability._ensure_state()
        capability._printers = {
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
            ]
        }
        capability._analysis = {
            "uploadId": "upload-1",
            "analysis": {
                "colors": [
                    {"slot": 1, "used": True, "color": "#ff0000"},
                    {"slot": 2, "used": True, "color": "#00ff00"},
                ]
            },
        }
        options = capability._validate_options(
            {
                "target": {"printerId": "ad5x", "nozzle": "0.4", "processName": ""},
                "options": {
                    "colorMapping": {"1": 2, "2": 1, "99": 4},
                    "layout": "center",
                    "preserveTemperatures": True,
                    "keepAllColors": False,
                },
            }
        )
        self.assertEqual(options["printerId"], "ad5x")
        self.assertIsNone(options["processName"])
        self.assertEqual(options["colorMapping"], {"1": 2, "2": 1})
        self.assertEqual(options["layout"], "center")


if __name__ == "__main__":
    unittest.main()

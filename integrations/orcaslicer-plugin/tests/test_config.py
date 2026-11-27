from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

import helpers


class ConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plugin, _ = helpers.load_plugin()

    def test_normalize_api_url(self) -> None:
        normalize = self.plugin.normalize_api_url
        self.assertEqual(normalize(" http://127.0.0.1:8080/ "), "http://127.0.0.1:8080")
        self.assertEqual(normalize("HTTPS://Example.COM/ff3mf/"), "https://example.com/ff3mf")
        self.assertEqual(normalize("http://[::1]:8080"), "http://[::1]:8080")

    def test_normalize_api_url_rejects_bad_values(self) -> None:
        normalize = self.plugin.normalize_api_url
        for value in [
            "",
            "ftp://example.com",
            "http://",
            "http://user:pass@example.com",
            "http://example.com/path?query=1",
            "http://example.com/#fragment",
            "http://example.com:99999",
        ]:
            with self.subTest(value=value), self.assertRaises(self.plugin.PluginError):
                normalize(value)

    def test_token_store_roundtrip_and_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = self.plugin.TokenStore(Path(directory))
            self.assertEqual(store.read(), "")
            store.write("abc123")
            self.assertEqual(store.read(), "abc123")
            self.assertEqual(json.loads((Path(directory) / "auth.json").read_text()), {"token": "abc123"})
            if os.name != "nt":
                mode = stat.S_IMODE((Path(directory) / "auth.json").stat().st_mode)
                self.assertEqual(mode, 0o600)
            store.clear()
            self.assertEqual(store.read(), "")

    def test_token_rejects_control_characters(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = self.plugin.TokenStore(Path(directory))
            with self.assertRaises(self.plugin.PluginError):
                store.write("abc\nxyz")
            self.assertEqual(store.read(), "")

    def test_config_never_contains_token(self) -> None:
        config = self.plugin.PluginConfig(
            api_url="http://127.0.0.1:8080",
            output_dir="/tmp/output",
            last_printer_id="ad5x",
            last_nozzle="0.4",
        )
        payload = config.to_dict()
        self.assertNotIn("token", json.dumps(payload).lower())
        self.assertEqual(self.plugin.PluginConfig.from_dict(payload).api_url, "http://127.0.0.1:8080")
        self.assertEqual(self.plugin.PluginConfig.from_dict({"apiUrl": "bad"}).api_url, self.plugin.DEFAULT_API_URL)

    def test_filename_sanitising(self) -> None:
        sanitize = self.plugin.safe_3mf_name
        self.assertEqual(sanitize("../../config.3mf"), "cfig.3mf")
        self.assertEqual(sanitize("my secret.3mf"), "my scrt.3mf")
        self.assertEqual(sanitize("certificate.3mf"), "crtificate.3mf")
        self.assertEqual(sanitize("CON.3mf"), "_CON.3mf")
        self.assertEqual(sanitize("my:model?.3mf"), "my_model_.3mf")
        self.assertTrue(sanitize("中文.3mf").endswith(".3mf"))
        self.assertEqual(sanitize(""), "project.3mf")
        long_name = "a" * 400 + ".3mf"
        self.assertLessEqual(len(sanitize(long_name)), 120)
        self.assertTrue(sanitize(long_name).endswith(".3mf"))

    def test_denied_path_components(self) -> None:
        self.assertTrue(self.plugin.has_denied_path_component(Path("/tmp/config/output")))
        self.assertTrue(self.plugin.has_denied_path_component(Path("/tmp/certificates")))
        self.assertFalse(self.plugin.has_denied_path_component(Path("/tmp/ff3mf/output")))

    def test_storage_cleanup_only_removes_old_temporaries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exports").mkdir()
            (root / "outputs").mkdir()
            old_export = root / "exports" / "ff3mf-old.3mf"
            old_part = root / "outputs" / "old.3mf.part"
            kept = root / "outputs" / "result.3mf"
            for file in (old_export, old_part, kept):
                file.write_text("x")
                os.utime(file, (1, 1))
            self.plugin.cleanup_storage(root)
            self.assertFalse(old_export.exists())
            self.assertFalse(old_part.exists())
            self.assertTrue(kept.exists())

    def test_unique_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = self.plugin.unique_path(root, "model.3mf")
            self.assertEqual(first.name, "model.3mf")
            first.write_text("x")
            second = self.plugin.unique_path(root, "model.3mf")
            self.assertEqual(second.name, "model-2.3mf")

    def test_inspect_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.3mf"
            helpers.make_project_3mf(path)
            self.assertTrue(self.plugin.inspect_3mf(path))
            self.assertTrue(self.plugin.inspect_3mf(path, require_settings=True))

            without = Path(directory) / "without.3mf"
            helpers.make_zip_without_settings(without)
            self.assertFalse(self.plugin.inspect_3mf(without))
            with self.assertRaises(self.plugin.PluginError):
                self.plugin.inspect_3mf(without, require_settings=True)

            sliced = Path(directory) / "plate.gcode.3mf"
            sliced.write_bytes(path.read_bytes())
            with self.assertRaises(self.plugin.PluginError):
                self.plugin.inspect_3mf(sliced)

    def test_inspect_rejects_sliced_entries_but_allows_slice_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.3mf"
            helpers.make_project_3mf(path)
            with zipfile.ZipFile(path, "a") as archive:
                archive.writestr("Metadata/slice_info.config", "{}")
            self.assertTrue(self.plugin.inspect_3mf(path))

            with zipfile.ZipFile(path, "a") as archive:
                archive.writestr("Metadata/plate_1.gcode", "G1 X0")
            with self.assertRaises(self.plugin.PluginError):
                self.plugin.inspect_3mf(path)


if __name__ == "__main__":
    unittest.main()

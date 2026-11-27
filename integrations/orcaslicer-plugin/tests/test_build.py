from __future__ import annotations

import importlib
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path

import helpers


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("Node.js is required to build the plugin")
        env = {**os.environ, "VERSION": "0.0.0-test"}
        result = subprocess.run(
            ["node", str(helpers.BUILD_SCRIPT)],
            cwd=helpers.REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise AssertionError(f"Plugin build failed:\n{result.stdout}\n{result.stderr}")
        cls.artifact = helpers.REPO_ROOT / "build" / "orca-plugin" / "ff3mf_orca_0_0_0_test.py"

    def test_artifact_has_metadata_and_embedded_ui(self) -> None:
        self.assertTrue(self.artifact.is_file())
        self.assertNotIn(
            ".",
            self.artifact.stem,
            "OrcaSlicer imports .py plugins by file stem; it must be import-safe",
        )
        source = self.artifact.read_text(encoding="utf-8")
        self.assertTrue(source.startswith("# /// script"))
        self.assertIn("[tool.orcaslicer.plugin]", source)
        self.assertIn('version = "0.0.0-test"', source)
        self.assertIn("PLUGIN_VERSION = \"0.0.0-test\"", source)
        self.assertNotIn("__FF3MF_VERSION__", source)
        self.assertNotIn("__FF3MF_PANEL_HTML__", source)
        self.assertNotIn("/*__FF3MF_CSS__*/", source)
        self.assertNotIn("/*__FF3MF_JS__*/", source)
        self.assertIn("@orca.plugin", source)
        self.assertIn("class FlashForgePage(orca.pages.PagesPluginCapabilityBase):", source)
        self.assertIn("window.orca", source)
        self.assertIn("--ff-blue", source)

    def test_artifact_compiles(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "py_compile", str(self.artifact)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_artifact_imports_by_file_stem_like_orcaslicer(self) -> None:
        orca, state = helpers.make_fake_orca()
        original = sys.modules.get("orca")
        module_name = self.artifact.stem
        sys.modules["orca"] = orca
        sys.path.insert(0, str(self.artifact.parent))
        try:
            sys.modules.pop(module_name, None)
            importlib.invalidate_caches()
            module = importlib.import_module(module_name)
            state["plugin_class"]().register_capabilities()
            self.assertEqual(state["capabilities"][0]().get_name(), "FF-3MF")
            self.assertIn("<html", module.PANEL_HTML)
        finally:
            sys.path.remove(str(self.artifact.parent))
            sys.modules.pop(module_name, None)
            if original is None:
                sys.modules.pop("orca", None)
            else:
                sys.modules["orca"] = original

    def test_artifact_loads_with_the_plugin_host(self) -> None:
        orca, state = helpers.make_fake_orca()
        original = sys.modules.get("orca")
        sys.modules["orca"] = orca
        try:
            module = types.ModuleType("built_ff3mf_orca")
            module.__file__ = str(self.artifact)
            sys.modules["built_ff3mf_orca"] = module
            exec(compile(self.artifact.read_text(encoding="utf-8"), str(self.artifact), "exec"), module.__dict__)
            state["plugin_class"]().register_capabilities()
            self.assertEqual(state["capabilities"][0]().get_name(), "FF-3MF")
            self.assertIn("<html", module.PANEL_HTML)
            self.assertGreater(len(module.PANEL_HTML), 10_000)
        finally:
            if original is None:
                sys.modules.pop("orca", None)
            else:
                sys.modules["orca"] = original


if __name__ == "__main__":
    unittest.main()

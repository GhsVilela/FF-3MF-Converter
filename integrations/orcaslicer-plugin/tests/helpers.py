from __future__ import annotations

import json
import sys
import tempfile
import types
import zipfile
from pathlib import Path
from typing import Any

TESTS_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = TESTS_DIR.parent
REPO_ROOT = PLUGIN_DIR.parents[1]
SOURCE_PATH = PLUGIN_DIR / "ff3mf_orca.py.in"
HTML_PATH = PLUGIN_DIR / "ui" / "panel.html"
CSS_PATH = PLUGIN_DIR / "ui" / "panel.css"
JS_PATH = PLUGIN_DIR / "ui" / "panel.js"
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build-orca-plugin.mjs"
FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "four-color.3mf"
MULTI_PREVIEW_FIXTURE = REPO_ROOT / "tests" / "fixtures" / "multi-plate-preview.3mf"


class FakePlater:
    def __init__(self) -> None:
        self.path = ""
        self.dirty = False
        self.presets_dirty = False
        self.export_error: Exception | None = None
        self.exported: list[Path] = []

    def project_path(self) -> str:
        return self.path

    def is_project_dirty(self) -> bool:
        return self.dirty

    def is_presets_dirty(self) -> bool:
        return self.presets_dirty

    def export_3mf_copy(self, path: str) -> None:
        if self.export_error is not None:
            raise self.export_error
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        make_project_3mf(destination)
        self.exported.append(destination)


def make_fake_orca() -> tuple[types.ModuleType, dict[str, Any]]:
    state: dict[str, Any] = {
        "permissions": None,
        "capabilities": [],
        "plugin_class": None,
        "messages": [],
        "storage": tempfile.mkdtemp(prefix="ff3mf-orca-test-"),
        "plater": FakePlater(),
    }

    class BaseCapability:
        def __init__(self) -> None:
            self._fake_config = "{}"

        def get_name(self) -> str:  # pragma: no cover - overridden
            return "base"

        def get_config(self) -> str:
            return self._fake_config

        def save_config(self, value: str) -> bool:
            self._fake_config = value
            return True

        def post_message(self, data: Any) -> None:
            state["messages"].append(data)

    class PagesBase(BaseCapability):
        pass

    class PackageBase:
        pass

    pages = types.ModuleType("orca.pages")
    pages.PagesPluginCapabilityBase = PagesBase

    class ExecutionResult:
        @staticmethod
        def success(message: str = "", data: str = "") -> "ExecutionResult":
            result = ExecutionResult()
            result.message = message
            result.data = data
            return result

        @staticmethod
        def skipped(message: str = "") -> "ExecutionResult":
            result = ExecutionResult()
            result.message = message
            return result

    plugin_module = types.ModuleType("orca.plugin")
    plugin_module.storage = lambda: state["storage"]

    ui = types.ModuleType("orca.host.ui")
    ui.message = lambda *args, **kwargs: "yes"
    ui.create_progress_dialog = lambda *args, **kwargs: None

    host = types.ModuleType("orca.host")
    host.plater = lambda: state["plater"]
    host.app_language = lambda: "en_US"
    host.app_info = lambda: {"version": "2.5.2", "mode": "editor"}
    host.plugin = plugin_module
    host.ui = ui

    orca = types.ModuleType("orca")
    orca.base = PackageBase
    orca.pages = pages
    orca.host = host
    orca.ExecutionResult = ExecutionResult
    orca.PluginResult = types.SimpleNamespace(
        Success="Success",
        Skipped="Skipped",
        RecoverableError="RecoverableError",
        FatalError="FatalError",
    )

    def request_permissions(**kwargs: Any) -> None:
        state["permissions"] = kwargs

    def register_capability(capability: Any) -> None:
        state["capabilities"].append(capability)

    def plugin_decorator(cls: Any) -> Any:
        state["plugin_class"] = cls
        return cls

    orca.request_permissions = request_permissions
    orca.register_capability = register_capability
    orca.plugin = plugin_decorator

    return orca, state


def load_plugin(html: str = "<!doctype html><html><body>test panel</body></html>"):
    orca, state = make_fake_orca()
    sys.modules["orca"] = orca
    source = SOURCE_PATH.read_text(encoding="utf-8")
    source = source.replace("__FF3MF_VERSION__", "0.0.0-test")
    source = source.replace(
        'PANEL_HTML = "__FF3MF_PANEL_HTML__"',
        f"PANEL_HTML = {json.dumps(html)}",
    )
    module_name = "ff3mf_orca_under_test"
    module = types.ModuleType(module_name)
    module.__file__ = str(SOURCE_PATH)
    sys.modules[module_name] = module
    exec(compile(source, str(SOURCE_PATH), "exec"), module.__dict__)
    return module, state


def make_project_3mf(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>"""
    model = """<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">BambuStudio-2.3.0</metadata>
 <resources/>
 <build/>
</model>"""
    settings = json.dumps({"printer_model": "Test", "layer_height": "0.2"})
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("3D/3dmodel.model", model)
        archive.writestr("Metadata/project_settings.config", settings)


def make_output_3mf(path: Path) -> None:
    make_project_3mf(path)


def make_zip_without_settings(path: Path) -> None:
    make_project_3mf(path)
    temp = path.with_suffix(".tmp")
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(temp, "w") as target:
        for name in source.namelist():
            if name != "Metadata/project_settings.config":
                target.writestr(name, source.read(name))
    temp.replace(path)

from __future__ import annotations

import re
import unittest

import helpers


class UiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.html = helpers.HTML_PATH.read_text(encoding="utf-8")
        self.css = helpers.CSS_PATH.read_text(encoding="utf-8")
        self.js = helpers.JS_PATH.read_text(encoding="utf-8")

    def test_placeholders_are_present(self) -> None:
        self.assertIn("/*__FF3MF_CSS__*/", self.html)
        self.assertIn("/*__FF3MF_JS__*/", self.html)
        self.assertIn("<!doctype html>", self.html.lower())
        self.assertIn("[hidden]", self.css)
        self.assertIn("window.orca", self.js)

    def test_all_directly_referenced_elements_exist(self) -> None:
        ids = set(re.findall(r'id="([^"]+)"', self.html))
        references = set(re.findall(r"\$\('([^']+)'\)", self.js))
        references.update(re.findall(r"setText\('([^']+)'", self.js))
        references.update(re.findall(r"setHidden\('([^']+)'", self.js))
        missing = sorted(references - ids)
        self.assertEqual(missing, [], f"JavaScript references missing element ids: {missing}")

    def test_dynamic_content_uses_text_nodes(self) -> None:
        for forbidden in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"):
            self.assertNotIn(forbidden, self.js)
        self.assertNotIn("eval(", self.js)

    def test_no_external_assets_are_loaded(self) -> None:
        self.assertNotIn("<script src=", self.html.lower())
        self.assertNotIn("<link ", self.html.lower())
        self.assertNotIn("url(http", self.css.lower())
        self.assertNotIn("@import", self.css.lower())
        self.assertNotIn("fetch(", self.js)
        self.assertNotIn("XMLHttpRequest", self.js)

    def test_file_source_controls_are_wired(self) -> None:
        for identifier in (
            "source-current",
            "source-file",
            "file-source-input",
            "choose-file-button",
            "clear-selected-file",
            "file-transfer-progress",
        ):
            self.assertIn(f'id="{identifier}"', self.html)
        self.assertIn("startFileTransfer", self.js)
        self.assertIn("file-chunk", self.js)
        self.assertIn("FILE_CHUNK_BYTES = 512 * 1024", self.js)
        self.assertIn("readAsDataURL", self.js)

    def test_preview_carousel_controls_are_wired(self) -> None:
        for identifier in (
            "preview-carousel",
            "preview-stage",
            "preview-controls",
            "preview-prev",
            "preview-next",
            "preview-pager",
            "preview-label",
        ):
            self.assertIn(f'id="{identifier}"', self.html)
        self.assertIn("preview-request", self.js)
        self.assertIn("previewImages", self.js)
        self.assertIn(".preview-controls", self.css)
        self.assertIn(".preview-pager", self.css)
        self.assertIn("max-height: 170px", self.css)
        self.assertNotIn("preview-dots", self.html)
        self.assertNotIn("preview-dot", self.css)

    def test_upload_progress_and_action_labels(self) -> None:
        self.assertIn("Upload &amp; analyse", self.html)
        self.assertIn("progress.indeterminate", self.js)
        self.assertIn("completedBytes", self.js)
        self.assertIn("progress-stripes", self.css)

    def test_offline_connection_retries_when_the_page_regains_focus(self) -> None:
        self.assertIn("retryOfflineConnection", self.js)
        self.assertIn("window.addEventListener('focus'", self.js)
        self.assertIn("document.addEventListener('visibilitychange'", self.js)

    def test_brand_header_and_source_tab_behavior(self) -> None:
        self.assertIn("<h1>FlashForge project converter</h1>", self.html)
        self.assertIn('class="brand-mark"', self.html)
        self.assertIn('fill="#09121a"', self.html)
        self.assertIn('stroke="#00a0e9"', self.html)
        self.assertIn('stroke="#e96114"', self.html)
        self.assertNotIn("selectedFile) $('file-source-input')?.click()", self.js)
        self.assertIn("$('choose-file-button')?.addEventListener", self.js)

    def test_bridge_and_theme_contract(self) -> None:
        self.assertIn("orca.postMessage", self.js)
        self.assertIn("orca.onMessage", self.js)
        self.assertIn("--orca-bg", self.css)
        self.assertIn("--orca-fg", self.css)
        self.assertIn("--orca-border", self.css)
        self.assertIn("--orca-font", self.css)


if __name__ == "__main__":
    unittest.main()

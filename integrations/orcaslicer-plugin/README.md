# FF-3MF OrcaSlicer plugin

Source for the OrcaSlicer 2.5+ **FF-3MF** tab. The plugin converts either
the project open in OrcaSlicer or a `.3mf` file selected from disk, sends it to
a running FF-3MF instance, follows the conversion and stores the Flash Studio
project and report.

The user guide, installation steps, permissions and troubleshooting are in
[../../docs/orcaslicer-plugin.md](../../docs/orcaslicer-plugin.md).

## Layout

```text
ff3mf_orca.py.in   Plugin source template and PEP 723 metadata
ui/panel.html      Tab structure and placeholders
ui/panel.css       Light/dark industrial panel styling
ui/panel.js        Tab state, colour mapping and page protocol
tests/             Standard-library unittest suite
```

`scripts/build-orca-plugin.mjs` inlines the CSS and JavaScript into the HTML,
embeds the HTML into `PANEL_HTML`, injects the repository version and writes a
single side-loadable `.py` file to `build/orca-plugin/`.

## Commands

```bash
npm run build:orca-plugin
npm run test:orca-plugin
```

The Python tests use a fake `orca` module for unit and contract tests, and start
the real built API for the integration test when `apps/api/dist/server.js`
exists. Build the workspace first with `npm run build`.

## Install for development

1. Run `npm run build:orca-plugin`.
2. In OrcaSlicer, open **Plugins → Install local plugin**.
3. Select `build/orca-plugin/ff3mf_orca_<version>.py`.
4. Enable the plugin and open the **FF-3MF** tab.

Do not edit generated artifacts in `build/`.

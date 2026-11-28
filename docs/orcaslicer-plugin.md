# OrcaSlicer plugin

The FF-3MF OrcaSlicer plugin adds an **FF-3MF** tab next to OrcaSlicer's
Prepare and Preview tabs. It converts either the project that is currently open
in OrcaSlicer or a `.3mf` file selected from disk into a Flash Studio-ready
project without a manual upload through the web UI.

The plugin is an integration client. It does **not** embed the conversion
engine and it does not slice. The conversion still runs in the FF-3MF API, and
the result is still opened in Flash Studio with **File → Open Project**.

## Requirements

- OrcaSlicer **2.5.0 or newer** with the Python plugin system. The host
  bindings used by the plugin are present in OrcaSlicer 2.5.0–2.5.2; run the
  manual checklist against the exact build you ship.
- A running FF-3MF instance: Docker, the portable application, or another
  reachable deployment.
- The FF-3MF printer profiles must include the target you want to open in Flash
  Studio.

The plugin itself uses only the Python standard library and has no runtime
dependencies.

## Install

### Release artifact

1. Download `ff3mf_orca_<version>.py` from the GitHub release. The version
   suffix uses underscores, for example `ff3mf_orca_0_4_0.py`, because
   OrcaSlicer imports a side-loaded `.py` plugin by its file stem.
2. In OrcaSlicer, open **Plugins** from the main menu.
3. Choose **Install local plugin** and select the `.py` file.
4. Enable the plugin if OrcaSlicer does not do it automatically.
5. Accept the permission prompt. The plugin requests permission to create a
   worker thread. Network access is requested when you test or use a specific
   FF-3MF URL.
6. Open the **FF-3MF** tab.

The plugin appears in the plugin list as **FF-3MF Converter for OrcaSlicer**.
The tab label is **FF-3MF**.

### Build from source

From the repository root:

```bash
npm run build:orca-plugin
```

The artifact is written to:

```text
build/orca-plugin/ff3mf_orca_<version>.py
```

Install that file through **Plugins → Install local plugin**.

## Start FF-3MF

The plugin needs the API. Start it before converting:

```bash
docker run -d \
  --name ff3mf \
  -p 8080:8080 \
  -v ff3mf_data:/data \
  ghcr.io/ghsvilela/ff-3mf-converter:latest
```

Or run the portable application and leave its window open. The default plugin
URL is `http://127.0.0.1:8080`.

If your instance uses a different port, a reverse-proxy path, a remote host or
`AUTH_TOKEN`, open the plugin's **Settings** panel and configure it. Use the URL
shown in the FF-3MF browser tab; do not append `/api`.

The plugin supports a base path, for example `http://nas.local/ff3mf`, and
HTTPS with a trusted certificate.

### API token

If FF-3MF was started with `AUTH_TOKEN`, enter the token in the plugin settings.
The token is stored in `auth.json` inside OrcaSlicer's plugin data folder with
user-only permissions where the operating system supports them. It is never
written to the plugin's visible JSON configuration and is never sent back to
the tab after it is saved.

## Use

1. Open the **FF-3MF** tab.
2. Choose the conversion source:
   - **Current OrcaSlicer project** uses the project that is open in OrcaSlicer.
   - **Select a .3mf file** switches to the file source. Click **Choose .3mf
     file** to open the picker. The selected file is copied into the plugin's
     staging folder in chunks; it does not need to be open in OrcaSlicer.
3. Click **Upload & analyse**. The plugin obtains the source, uploads it and
   shows the analysis, plate preview and used filaments. Multi-plate projects
   get a preview carousel with previous/next controls and a plate counter.
4. Choose the target printer, nozzle and process. The process defaults to
   **Auto**, which makes FF-3MF select the target process closest to the
   source's layer height.
5. Review the colour mapping. For a multicolour printer, every used source
   colour is mapped to a target slot. If the source has more colours than the
   target slots, enable **Keep every source colour** to retain one filament slot
   per source colour.
6. Set the layout and temperature options, then click **Convert to Flash
   Studio**.
7. Watch the progress, then click **Open output folder**.
8. In Flash Studio, use **File → Open Project** and select the converted file.

The result is an editable project, not G-code. The conversion report is saved
next to the output as `<name>.report.json`.

### Source options

**Current OrcaSlicer project** is the default. It preserves the existing
workflow and can include unsaved edits when OrcaSlicer exposes a temporary
project export.

**Select a .3mf file** is independent of the project open in OrcaSlicer. The
browser file picker gives the plugin only the file bytes, not a local path. The
page reads the file in 512 KiB slices and sends them to the plugin, which writes
a temporary copy under its data folder, validates the ZIP structure and uploads
it to FF-3MF. The temporary copy is deleted when the file is cleared, replaced,
or the plugin unloads. Selected files are also cleaned up on a later startup if
they are left behind.

This source accepts editable Orca-family projects and generic `.3mf` files. A
sliced `.gcode.3mf` print file is rejected. The declared FF-3MF upload limit
(`MAX_UPLOAD_MB`) applies to both source options.

### Plate previews

After analysis, the source card shows the plate render carousel. The image sits
in its own stage, with the previous/next controls and the compact `PLATE X OF Y`
counter on a row below it, so neither overlaps the render. The carousel also
responds to Left/Right arrow keys when it has focus. Multi-plate projects can
therefore be reviewed without leaving the tab.

Plate images are fetched lazily through the existing
`GET /api/uploads/:id/thumbnail?plate=N` endpoint and cached by the plugin. This
avoids loading every plate image into the initial page snapshot and keeps large
multi-plate projects responsive. If the source only embeds previews for some
plates, the counter shows the actual plate and the pager title notes how many
previews are available.

### Upload & analyse versus Convert

**Upload & analyse** uploads the source to `POST /api/uploads`. The server
analyses it to build the summary shown in the tab: objects, plates, colours,
layer height, preview and warnings. It returns an `uploadId` and enables the
colour mapping and Convert button. It does not create a converted project.

**Convert** sends the existing `uploadId` to `POST /api/conversions`. It does
not upload the file again. The conversion worker re-reads the stored source to
build the full target configuration and rewrite the model. The first conversion
stage appears as **Preparing the conversion**, not as another upload or another
press of the analyse button.

The upload phase shows real byte progress from 0% to 100%. When the upload has
finished, the progress bar switches to an indeterminate
**Analysing source on the converter** state while the server prepares the
summary and colour data.

### Current-project source

The plugin prefers the saved project when it is clean. That keeps the converted
source identical to the file on disk.

When the project has unsaved changes, the plugin asks OrcaSlicer to export a
temporary project copy through its plugin host API. The copy includes the
current session without changing the project's saved state or dirty flag. The
temporary file is deleted after it has been uploaded.

If temporary export is unavailable, the plugin can fall back to the last saved
project after asking for confirmation. If the project has never been saved, it
must be saved once before conversion.

### Output location

By default, converted projects are written to:

```text
<OrcaSlicer data directory>/orca_plugins/plugin_data/<plugin key>/outputs/
```

The exact path depends on the platform and OrcaSlicer installation. The
**Open output folder** button reveals it. You can set a custom output folder in
the plugin settings; the plugin writes there directly. Relative custom paths
resolve inside the plugin data folder, and `~` is expanded to the user's home
directory.

Custom output folders outside OrcaSlicer's data directory are written by the
plugin's worker thread. Choose a folder you control and make sure the path does
not contain one of OrcaSlicer's denied path keywords (`conf`, `cert` or
`secret`), which the plugin host blocks.

## Permissions and security

The plugin is not a sandbox, and the FF-3MF conversion engine treats the source
project as untrusted data.

- The plugin declares permission to create a worker thread at activation.
  Network access is handled by OrcaSlicer's audit hook when a URL is tested or
  used; use **Test only** in Settings to perform an audited check of the
  configured URL. The long-running conversion work itself uses a worker thread.
- The project is uploaded only to the FF-3MF instance configured in the plugin.
  No telemetry or external service is contacted by the plugin.
- A file selected through the picker is read by the page and copied into the
  plugin data folder. The plugin is not given the file's local path.
- The API token is kept out of the tab state and logs.
- The plugin displays project names, report strings and API errors as text. It
  does not insert project metadata into HTML.
- Folder-opening actions use fixed operating-system commands with argument
  lists, not a shell.
- OrcaSlicer's plugin audit hook does not propagate its permission context to
  worker threads. The plugin limits worker network traffic to the configured
  FF-3MF URL and uses the worker only for upload, poll, download and report
  writing.

Use HTTPS or a trusted private network for a remote FF-3MF instance. HTTP is
acceptable for a loopback instance.

## Troubleshooting

### Activation fails

The most common cause is a plugin filename with a dot in its stem. OrcaSlicer
imports a side-loaded `.py` plugin by file stem, so `ff3mf_orca-0.5.1.py`
becomes the import name `ff3mf_orca-0.5.1` and fails. Use the release artifact
named like `ff3mf_orca_0_5_0.py`, or rename the installed file so its stem has
no dots.

If the filename is already import-safe, open **Plugins → Diagnostics** and
check OrcaSlicer's `log/python_*.log` for the traceback. A failed permission
request also aborts activation; reinstall or activate again and accept the
permission dialog.

### The connection stays offline after approving the network prompt

OrcaSlicer prompts for network access the first time the plugin contacts a
host. The request that triggered the prompt is blocked, so the plugin retries
the connection automatically for about 30 seconds and re-checks whenever the
page regains focus. Approve the prompt once; the pill should turn green without
another click. If it remains offline, click the **Offline** pill to run a fresh
check. The pill is also a manual refresh button.

### The FF-3MF tab is missing

- Confirm OrcaSlicer is 2.5.0 or newer.
- Open **Plugins** and check that **FF-3MF Converter for OrcaSlicer** is
  installed and activated.
- Check **Preferences → General → Plugins → Visible plugin pages**. If several
  plugin pages are installed, additional pages are available from the last
  plugin tab's overflow menu.
- Restart OrcaSlicer after installing a new plugin file.

### The connection is offline

- Confirm FF-3MF is running and open its browser tab.
- Check the URL and port. Docker must publish the port (`-p 8080:8080`).
- For a remote instance, check firewall rules and reverse-proxy settings.
- Click the connection status pill in the plugin header to check again.

### Token required or unauthorized

- Enter the same `AUTH_TOKEN` that FF-3MF uses.
- Use **Save and test** in the plugin settings.
- Clearing the token is supported; local instances usually do not need one.

### Upload & analyse is disabled or export fails

- If you are using **Current OrcaSlicer project**, the project may need to be
  saved once. Use **File → Save Project** in OrcaSlicer and try again.
- If you are using **Select a .3mf file**, make sure the file has finished
  transferring and that the file source is selected.
- Temporary export requires OrcaSlicer's 3D view to be ready. Switch to Prepare
  or Preview, wait for the view to load, then return to the FF-3MF tab.
- If OrcaSlicer is showing a sliced G-code file, open the editable `.3mf`
  project instead. The plugin cannot export a project from the G-code viewer.
- If the current OrcaSlicer project changes while its analysis is running, the
  plugin discards that analysis so a stale colour map cannot be used. Analyse
  again after the edit. A selected-file analysis is independent of the open
  project.
- If the current project changes during conversion, the result still reflects
  the state at the start of the conversion and the plugin shows a notice.
  Analyse again before converting the newer state.
- If the current OrcaSlicer build does not expose temporary project export, save
  the project and analyse again. The plugin will use the saved file after
  confirmation.

### The file picker does not open

Use the **Select a .3mf file** source tab, then click **Choose .3mf file**. If
the WebView cannot open its file picker, check the OrcaSlicer log and try a
different OrcaSlicer build. The current-project source remains available.

### A selected file fails to transfer or is rejected

- The file must be an editable `.3mf` project; `.gcode.3mf` print files are
  rejected.
- The file must be smaller than the FF-3MF `MAX_UPLOAD_MB` limit.
- Large files are transferred in 512 KiB slices with an acknowledgement per
  slice. If the progress stalls, click **Clear file** and select it again.
- If the project changes in OrcaSlicer while a selected file is being
  transferred, the selected-file analysis is independent and is not discarded.
  Only the selected file's own transfer affects it.

### The upload is rejected as too large

FF-3MF's `MAX_UPLOAD_MB` limit applies to plugin uploads too. Raise the limit on
the server or reduce the project size. The default is 100 MB.

### A path is blocked by OrcaSlicer

OrcaSlicer's plugin audit hook denies path components containing `conf`,
`cert` or `secret`, even inside otherwise allowed folders. Rename the project
or choose a different output folder.

### Where are the plugin logs?

Open the OrcaSlicer data directory and look for `log/python_*.log`. The plugin
prefixes its messages with `[ff3mf]`. The OrcaSlicer Plugins dialog also has a
**Diagnostics** tab for load errors.

## Development

The source is in `integrations/orcaslicer-plugin`.

```bash
npm run build:orca-plugin
npm run test:orca-plugin
```

`test:orca-plugin` runs the Python unit tests, the build/embedded-UI check and,
when the workspace API has been built, an end-to-end upload → convert →
download test against a temporary FF-3MF instance.

To iterate in OrcaSlicer:

1. Run `npm run build:orca-plugin`.
2. Open **Plugins → Install local plugin** and select the generated `.py`.
3. Edit the source and rebuild; reinstall or use **Reinstall** in the Plugins
   dialog to reload the new file.
4. Keep `python_*.log` open while testing.

The build script embeds `ui/panel.html`, `ui/panel.css` and `ui/panel.js` into a
single `.py` artifact. The source template is `ff3mf_orca.py.in`. Do not edit
the generated artifact in `build/`.

## Manual validation

Before release, verify in OrcaSlicer 2.5.0–2.5.2 (at minimum 2.5.0 and the
latest patch):

- [ ] The plugin installs, appears as activated and opens the FF-3MF tab.
- [ ] The permission prompt appears on first install and the plugin can connect.
- [ ] Offline and token-required states show actionable messages.
- [ ] A saved, clean project converts using the saved file.
- [ ] A modified project converts using the temporary export and includes the
      unsaved changes.
- [ ] A project that has never been saved shows the save-first guidance.
- [ ] A selected `.3mf` file converts without being open in OrcaSlicer.
- [ ] Selecting a `.gcode.3mf` file is rejected.
- [ ] Clearing or replacing a selected file releases the staged copy.
- [ ] Project edits do not invalidate an analysis of a selected file.
- [ ] Colour mapping, keep-all-colours and single-colour collapse behave as
      expected.
- [ ] Cancel stops a running conversion.
- [ ] The report is written next to the output.
- [ ] The result opens in Flash Studio with the expected printer, nozzle,
      process and filaments, and slices successfully.
- [ ] Light and dark OrcaSlicer themes remain readable.

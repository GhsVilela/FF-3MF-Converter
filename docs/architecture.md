# Architecture

FF-3MF Converter is a stateless web application with a pure TypeScript
conversion core, a Fastify API and a React UI.

```
Browser
  │  multipart upload / JSON / download
  ▼
Fastify API (apps/api)
  │  job queue, temp files, TTL cleanup
  ▼
Conversion core (packages/core)
  │  ZIP + XML + JSON, paint codec, config translation
  ▼
Target profiles (profiles/)
  │  OrcaSlicer-derived templates, machine/process/filament data
  ▼
Flash Studio-ready .3mf
```

## Components

### `apps/web`

Single-page React application built with Vite. It talks to the API through
relative URLs, supports English and Portuguese (Brazil), and keeps no project
data outside the current browser session. The UI is served as static files by
Fastify in production.

### `apps/api`

Fastify server with:

- `POST /api/uploads` — multipart upload, safe temp file, source analysis.
- `POST /api/conversions` — validates the target and queues a job.
- `GET /api/conversions/:id` — status, report and download metadata.
- `GET /api/conversions/:id/download` — streams the output.
- Static UI hosting and a health endpoint.

Jobs are kept in memory and files under `DATA_DIR`. There is no database. A
single instance is expected; the design intentionally avoids Redis or MongoDB
for a NAS-friendly deployment.

### `packages/core`

The conversion engine:

- `zip.ts` — safe ZIP reader/writer with entry, size and compression limits.
- `xml.ts` — streaming model scanner and XML rewriter. Untouched tags are
  copied verbatim, namespace resolution is skipped and DTDs are rejected.
- `paint.ts` — TriangleSelector paint codec and remapping.
- `source.ts` — source detection, analysis, bounds and plate data.
- `config.ts` — target template, setting translation, filaments, report.
- `convert.ts` — packaging, metadata, validation and report assembly.
- `model-settings.ts` — per-object/plate XML patching.

The core has no dependency on Fastify or React. It is reused by the CLI and is
suitable for a future browser-only mode.

### `packages/profiles`

Loads the catalog and resolved target data from `profiles/`. The default path is
resolved relative to the package, with `PROFILES_DIR` as an override.

### `apps/cli`

`ff3mf` wraps the core for local and automated use. It supports printer
listing, analysis and conversion with JSON reports.

## Data flow and trust boundaries

1. The uploaded file is untrusted. The ZIP reader validates every entry and
   enforces resource limits before parsing.
2. XML is parsed without DTD or external entity resolution.
3. The target profile is trusted data shipped with the image.
4. Output validation reopens the produced ZIP and checks identity, counts and
   paint ranges before the file is exposed.
5. Temp files are cleaned after completion, on TTL expiry and on startup.

## Failure handling

- Conversion failures delete the partial output.
- Validation failures return `OUTPUT_VALIDATION_FAILED` and never expose a
  broken file.
- The API returns structured error codes and human-readable messages.
- The UI shows actionable errors and warnings from the report.

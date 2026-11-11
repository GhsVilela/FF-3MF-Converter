# API

The API is served under `/api`. Requests and responses are JSON except for file
upload and download. When `AUTH_TOKEN` is configured, send
`Authorization: Bearer <token>` or `X-API-Key: <token>`.

## Health

```http
GET /api/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 42,
  "profiles": {
    "generatedAt": "2026-11-11",
    "sources": {},
    "printerCount": 5
  },
  "runner": { "active": 0, "queued": 0 }
}
```

## Version

```http
GET /api/version
```

## Printers

```http
GET /api/printers
```

Returns the catalog of printers, nozzles, process presets and material names.
The UI builds its printer picker from this response.

## Upload and analyse

```http
POST /api/uploads
Content-Type: multipart/form-data

file=@model.3mf
```

Response `201`:

```json
{
  "uploadId": "2e5f...",
  "analysis": {
    "fileName": "model.3mf",
    "sourceApp": "Bambu Studio / OrcaSlicer family",
    "sourcePrinter": "Bambu Lab X1 Carbon",
    "plates": 1,
    "objects": 3,
    "triangles": 124000,
    "usedColorCount": 4,
    "hasPaint": true,
    "warnings": []
  }
}
```

The upload is kept for `JOB_TTL_MINUTES`.

## Start a conversion

```http
POST /api/conversions
Content-Type: application/json

{
  "uploadId": "2e5f...",
  "printerId": "ad5x",
  "nozzle": "0.4",
  "processName": "0.20mm Standard @FF AD5X",
  "colorMapping": { "1": 1, "2": 2, "3": 3, "4": 4 },
  "preserveTemperatures": true,
  "layout": "center"
}
```

`processName` is optional; without it the API picks the process closest to the
source layer height. `layout` is `center`, `keep` or `scale`.

Response `202`:

```json
{
  "id": "8b4c...",
  "status": "queued",
  "progress": 0,
  "download": null
}
```

## Poll a conversion

```http
GET /api/conversions/:id
```

```json
{
  "id": "8b4c...",
  "status": "completed",
  "progress": 100,
  "report": {
    "source": {},
    "target": {},
    "settings": [],
    "filaments": [],
    "plates": [],
    "warnings": [],
    "stats": {}
  },
  "download": {
    "url": "/api/conversions/8b4c.../download",
    "filename": "model_ad5x.3mf",
    "size": 123456
  }
}
```

Status is `queued`, `converting`, `completed` or `failed`. A failed job includes
an `error` object with `code`, `message` and optional `details`.

## Download

```http
GET /api/conversions/:id/download
```

Returns `application/octet-stream` with the converted `.3mf` as an attachment.
The job must be completed.

## Delete

```http
DELETE /api/conversions/:id
```

Removes the job and its temporary output.

## Error format

```json
{
  "error": {
    "code": "SLICED_FILE",
    "message": "This is a sliced print file...",
    "details": []
  }
}
```

Common codes: `INVALID_FILE`, `INVALID_ZIP`, `ZIP_LIMIT`, `UNSAFE_PATH`,
`NO_MODEL`, `SLICED_FILE`, `UNSUPPORTED_FILE`, `PROFILE_ERROR`,
`CONVERSION_FAILED`, `OUTPUT_VALIDATION_FAILED`.

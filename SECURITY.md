# Security Policy

## Supported versions

Security fixes are applied to the latest release line.

| Version | Supported   |
| ------- | ----------- |
| 0.1.x   | Yes         |
| Older   | Best effort |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

<https://github.com/GhsVilela/FF-3MF-Converter/security/advisories/new>

Do not open a public issue for a suspected vulnerability. Include:

- A description of the issue and its impact.
- Steps to reproduce or a minimal proof of concept.
- The affected version or commit.
- Any deployment details that matter (reverse proxy, `AUTH_TOKEN`, limits).

You should receive an acknowledgement within a few business days. Please allow
time for a fix and coordinated disclosure before publishing details.

## Threat model

FF-3MF treats every uploaded file as hostile. The main risks are:

- ZIP bombs and excessive decompression.
- Path traversal and unsafe archive names.
- XML external entities and malicious XML.
- Oversized uploads or conversion queues.
- Resource exhaustion from large models.
- Exposure of the app to an untrusted network.

The implementation mitigates these with archive size/entry/ratio limits, safe
path normalisation, a non-entity XML parser, upload limits, a bounded job queue,
per-conversion timeouts, temporary-file TTL cleanup, security headers, rate
limiting and an optional bearer token.

## Deployment guidance

- Put the app behind a reverse proxy with TLS.
- Set `AUTH_TOKEN` if the app is reachable beyond a trusted LAN, or add
  authentication at the proxy.
- Keep the container read-only and use the provided `tmpfs` for `/tmp`.
- Limit `MAX_UPLOAD_MB`, `MAX_CONCURRENT_JOBS` and `JOB_TTL_MINUTES` to values
  appropriate for the host.
- Keep the host, Docker and the image updated.
- Do not expose the container's filesystem or Docker socket.

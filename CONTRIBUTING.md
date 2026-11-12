# Contributing

Thanks for helping improve FF-3MF Converter. Contributions of code, tests,
documentation, printer profiles and bug reports are welcome.

## Before you start

- Read [AGENTS.md](AGENTS.md) for the architecture and conversion invariants.
- Check open issues and discussions before starting a large change.
- For a new printer, open an issue first. A printer needs a real profile and a
  validation plan, not just a name.

## Development setup

Requirements: Node.js 22+, npm and Docker (for container checks).

```bash
npm ci
npm run build:packages
npm run build -w @ff3mf/api
npm run dev
```

The API runs on <http://localhost:8080>; the Vite UI runs on
<http://localhost:5173> with `/api` proxied to the API.

## Checks

Run these before opening a pull request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build:packages
npm test
npm run build
```

For UI or container changes, also build and run the image:

```bash
docker build -t ff3mf:local .
docker run --rm -p 8080:8080 -v ff3mf_data:/data ff3mf:local
```

## Tests and fixtures

- Use synthetic 3MF fixtures; do not commit third-party models.
- Keep fixtures small and deterministic.
- Add tests for new paint/config transformations, filament mapping, printer
  profiles and error paths.
- If you change the conversion output, update the golden assertions and explain
  the behavioural change in the pull request.

## Printer and profile changes

Profiles are generated from pinned OrcaSlicer releases. Do not hand-edit the
JSON files without a generator fix and a clear explanation.

A new printer requires:

1. A target template captured from headless OrcaSlicer.
2. Resolved machine, process and filament data for every supported nozzle.
3. Catalog and documentation updates.
4. A successful single-colour and multi-colour conversion test.
5. A manual Flash Studio check, or a documented limitation.

See [docs/profiles.md](docs/profiles.md).

## Pull requests

- Keep changes focused and explain the user-facing effect.
- Include screenshots for UI changes.
- Update documentation when behaviour, configuration or printer support changes.
- Do not commit secrets, uploads, converted files or generated data volumes.
- Do not add dependencies with incompatible licenses.

## License

By contributing, you agree that your contribution is licensed under the
project's AGPL-3.0-or-later license.

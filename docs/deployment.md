# Deployment

## Portable executables

The release page includes self-contained archives for users who do not want
Docker:

- Windows x64: extract `FF-3MF-Converter-<version>-win-x64.zip` and run `FF-3MF.exe`.
- Linux x64: extract `FF-3MF-Converter-<version>-linux-x64.tar.gz` and run `./ff3mf`.
- macOS Apple Silicon: extract
  `FF-3MF-Converter-<version>-macos-arm64.tar.gz` and run `./ff3mf`.
- macOS Intel: extract `FF-3MF-Converter-<version>-macos-x64.tar.gz` and run
  `./ff3mf`.

The launcher starts the app on `127.0.0.1:8080`, opens the browser and stores
data in the user data directory. The archive includes the Node.js runtime and
the FlashForge profiles. Use `--no-browser` on a headless machine, `--port` to
choose another port and `--data-dir` to control storage.

The macOS archives are not signed with an Apple Developer ID and are not
notarized. If Gatekeeper blocks the first launch, remove the quarantine flag
from the extracted folder:

```bash
xattr -dr com.apple.quarantine FF-3MF-Converter-<version>-macos-arm64
```

Use `macos-x64` on Intel Macs. Downloading with `curl -L` instead of a browser
avoids the quarantine flag.

## Docker

GitHub Container Registry:

```bash
docker run -d \
  --name ff3mf \
  --restart unless-stopped \
  -p 8080:8080 \
  -v ff3mf_data:/data \
  ghcr.io/ghsvilela/ff-3mf-converter:latest
```

Docker Hub:

```bash
docker run -d \
  --name ff3mf \
  --restart unless-stopped \
  -p 8080:8080 \
  -v ff3mf_data:/data \
  docker.io/ghsvilela/ff-3mf-converter:latest
```

The image is available for `linux/amd64` and `linux/arm64`.

## Docker Compose

The repository includes a hardened Compose file:

```bash
# GitHub Container Registry (default)
docker compose up -d

# Docker Hub
FF3MF_IMAGE=docker.io/ghsvilela/ff-3mf-converter:latest docker compose up -d
```

It uses a named volume, a read-only root filesystem, a `tmpfs` for `/tmp`, and a
health check. Set `FF3MF_IMAGE` in `.env` or the environment to switch
registries. Copy `.env.example` to `.env` to set optional values.

## TrueNAS SCALE

1. Add a dataset or host path for application data.
2. Create a **Custom App** with image
   `ghcr.io/ghsvilela/ff-3mf-converter:latest`.
3. Map container port `8080` to a free host port.
4. Mount the dataset at `/data`.
5. Optionally set `AUTH_TOKEN`, `MAX_UPLOAD_MB`, `MAX_CONCURRENT_JOBS` and
   `JOB_TTL_MINUTES`.

The container runs as UID/GID `1000:1000`. Make the dataset writable by that
user, or configure the app's user/group in TrueNAS to match. No database is
required.

## Reverse proxy

Terminate TLS at your proxy. The app serves the UI and API on one HTTP port.

### Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name ff3mf.example.com;

  client_max_body_size 100m;
  proxy_read_timeout 180s;
  proxy_send_timeout 180s;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

### Caddy

```caddyfile
ff3mf.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
```

### Subpath

The UI uses relative asset and API URLs, so it can be served under a subpath
such as `/ff3mf/`. Configure the proxy to strip the prefix before forwarding:

```nginx
location /ff3mf/ {
  rewrite ^/ff3mf/(.*)$ /$1 break;
  proxy_pass http://127.0.0.1:8080;
}
```

Set `TRUST_PROXY=true` when the proxy supplies `X-Forwarded-*` headers and the
app is not directly reachable.

## Storage and cleanup

- `DATA_DIR` holds temporary uploads and converted files.
- Jobs and uploads expire after `JOB_TTL_MINUTES`.
- Staged uploads are restored from `DATA_DIR` after a restart, so a redeploy or
  container restart does not invalidate an upload that is still within its TTL.
  Conversion jobs themselves are in memory; retry the conversion after a restart.
- The container removes stale files on startup and every minute.
- A 100 MB upload may need several hundred MB of temporary disk while the output
  is assembled. Keep this in mind on small NAS devices.
- Do not back up `DATA_DIR`; it contains only transient files.

## Authentication

Set `AUTH_TOKEN` to require a bearer token for `/api`:

```bash
docker run -d \
  -e AUTH_TOKEN="$(openssl rand -hex 32)" \
  ...
```

Enter the token in the UI when prompted. It is stored in the browser tab's
session storage. For multi-user or internet-facing deployments, combine this
with reverse-proxy authentication and TLS.

## Resource tuning

| Situation                | Suggestion                                        |
| ------------------------ | ------------------------------------------------- |
| Small NAS, 2 GB RAM      | `MAX_CONCURRENT_JOBS=1`, `MAX_UPLOAD_MB=50`       |
| 4+ GB RAM, several users | `MAX_CONCURRENT_JOBS=2`, `MAX_UPLOAD_MB=100`      |
| Slow disk                | Keep `JOB_TTL_MINUTES` low and monitor free space |
| Public exposure          | `AUTH_TOKEN`, TLS, rate limiting at the proxy     |

## Updating

```bash
docker compose pull
docker compose up -d
```

Check the release notes for profile or compatibility changes. The `/api/health`
endpoint reports the loaded profile manifest.

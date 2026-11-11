# Deployment

## Docker

```bash
docker run -d \
  --name open3mf \
  --restart unless-stopped \
  -p 8080:8080 \
  -v open3mf_data:/data \
  ghcr.io/ghsvilela/open3mfconverter:latest
```

The image is available for `linux/amd64` and `linux/arm64`.

## Docker Compose

The repository includes a hardened Compose file:

```bash
docker compose up -d
```

It uses a named volume, a read-only root filesystem, a `tmpfs` for `/tmp`, and a
health check. Copy `.env.example` to `.env` to set optional values.

## TrueNAS SCALE

1. Add a dataset or host path for application data.
2. Create a **Custom App** with image
   `ghcr.io/ghsvilela/open3mfconverter:latest`.
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
  server_name open3mf.example.com;

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
open3mf.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
```

### Subpath

The UI uses relative asset and API URLs, so it can be served under a subpath
such as `/open3mf/`. Configure the proxy to strip the prefix before forwarding:

```nginx
location /open3mf/ {
  rewrite ^/open3mf/(.*)$ /$1 break;
  proxy_pass http://127.0.0.1:8080;
}
```

Set `TRUST_PROXY=true` when the proxy supplies `X-Forwarded-*` headers and the
app is not directly reachable.

## Storage and cleanup

- `DATA_DIR` holds temporary uploads and converted files.
- Jobs and uploads expire after `JOB_TTL_MINUTES`.
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

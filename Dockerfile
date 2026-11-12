# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22
ARG BUILDPLATFORM=linux/amd64

# ---------------------------------------------------------------------------
# Build dependencies
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/profiles/package.json packages/profiles/package.json
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Build the workspace
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Production dependencies only
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/profiles/package.json packages/profiles/package.json
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    WEB_DIR=/app/apps/web/dist

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY packages/profiles/package.json packages/profiles/package.json
COPY --from=build /app/packages/profiles/dist packages/profiles/dist
COPY packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/cli/package.json apps/cli/package.json
COPY --from=build /app/apps/cli/dist apps/cli/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY profiles profiles
# The UI is static at runtime; its build-only packages are not needed in the image.
RUN rm -rf \
  node_modules/@ff3mf/web \
  node_modules/@fontsource \
  node_modules/@fontsource-variable \
  node_modules/@playwright \
  node_modules/@tailwindcss \
  node_modules/@vitejs \
  node_modules/react \
  node_modules/react-dom \
  node_modules/lucide-react \
  node_modules/tailwindcss \
  node_modules/tailwind-merge \
  node_modules/clsx \
  node_modules/vite \
  && chmod +x apps/cli/dist/index.js \
  && ln -s /app/apps/cli/dist/index.js /usr/local/bin/ff3mf

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

ARG VERSION=dev
ARG GIT_SHA=dev
ARG BUILD_DATE=
ENV APP_VERSION=${VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_DATE=${BUILD_DATE}

LABEL org.opencontainers.image.title="FF-3MF Converter" \
      org.opencontainers.image.description="Self-hosted 3MF project converter for FlashForge printers" \
      org.opencontainers.image.vendor="FF-3MF" \
      org.opencontainers.image.url="https://github.com/GhsVilela/FF-3MF-Converter" \
      org.opencontainers.image.source="https://github.com/GhsVilela/FF-3MF-Converter" \
      org.opencontainers.image.documentation="https://github.com/GhsVilela/FF-3MF-Converter/blob/main/README.md" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_SHA}"

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/server.js"]

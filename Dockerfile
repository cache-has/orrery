# syntax=docker/dockerfile:1
#
# Orrery server — base image.
#
# Built and published as a versioned base image. Downstream projects extend
# this image by copying their orrery.config.yaml + dashboards/connections
# into /workspace.
#
# Default CMD runs `orrery dev` because dev is currently the only command
# that starts the HTTP server. File watching runs but is harmless inside a
# container (files never change). If/when a dedicated `serve` subcommand is
# added upstream, swap the CMD to use it.

FROM node:20-slim AS builder

# Native deps for better-sqlite3. DuckDB ships prebuilt glibc binaries — requires
# a glibc-based image (NOT alpine/musl).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build

# Drop devDependencies to shrink the runtime node_modules.
RUN npm prune --omit=dev


FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Editor client is bundled on-demand at runtime by esbuild against TypeScript
# source — it isn't part of the tsup entry points. tsup flattens everything
# into chunks under /app/dist/, so at runtime `__dirname` of the bundled
# editor-bundle module is /app/dist and its first candidate path is
# `../editor-client/main.ts` → /app/editor-client/main.ts. Place source there.
COPY --from=builder /app/src/editor-client ./editor-client

# Default workspace — downstream images overlay their config here.
WORKDIR /workspace

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/dist/cli/index.js"]
CMD ["dev", "--no-open", "--port", "3000", "--project", "/workspace"]

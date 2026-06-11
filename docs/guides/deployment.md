<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Deploying OpenBoard

A task-focused guide to running OpenBoard as a self-hosted container in
production: building an image, storing dashboards in object storage, wiring
database credentials, automating deploys with CI, and putting it behind your own
single sign-on.

This guide describes a *pattern*, not a single vendor. The examples use AWS
(ECR, a container runtime, S3, SSM/Secrets Manager) because it is common, but the
same shape works on any registry plus any container host (ECS, Fly.io, Cloud
Run, Render, a plain VM with Docker, Kubernetes).

## The deployment model

OpenBoard is a server-rendered Node app. A production deployment has four pieces:

```
                        your identity provider (SSO)
                                  |
                                  v
   user ──HTTPS──►  auth proxy  ──►  OpenBoard server  ──►  SQL database
                    (you own)        (this project)         (your warehouse)
                         |                  |
                         |                  └──►  object storage (.board files)
                         └─ verifies SSO, injects trusted headers
```

1. **The OpenBoard server** — the container from this project, serving dashboards
   on a port (default `3000`).
2. **Dashboard storage** — the `.board` files. Either baked into the image, or
   (recommended for editor use) read from an object-storage bucket so user edits
   survive container recycles.
3. **The database** — your SQL warehouse, reached with credentials supplied as
   environment variables.
4. **An auth proxy** — optional but recommended. OpenBoard has no built-in login;
   it trusts an upstream proxy to authenticate users and pass identity via
   headers. See [Authentication](#authentication).

## 1. Build a base image

OpenBoard ships a `Dockerfile` at the repository root that builds a runnable
server image. Build and tag it once per OpenBoard version; downstream images
extend it.

```bash
# From a checkout of this repository:
docker build -t openboard-base:1.0.0 .
```

The base image:

- builds the TypeScript, prunes dev dependencies, and runs under `tini`;
- uses a glibc base (`node:20-slim`) because DuckDB ships prebuilt glibc
  binaries — do not switch to Alpine/musl;
- defaults to `WORKDIR /workspace`, which downstream images overlay with their
  own config.

Push it to your registry:

```bash
docker tag openboard-base:1.0.0 <registry>/openboard-base:1.0.0
docker push <registry>/openboard-base:1.0.0
```

> Replace `<registry>` with your registry host, e.g.
> `<account-id>.dkr.ecr.<region>.amazonaws.com`. Never hard-code an account id or
> registry URL in a public file — read it from CI configuration or a parameter
> store at build time.

## 2. Build your project image

Your deployment image is thin: it extends the base and copies in your project
files (config, connections, queries, theme, assets). Dashboards themselves are
usually *not* baked in — see step 3.

```dockerfile
# Dockerfile (your analytics project)
FROM <registry>/openboard-base:1.0.0

WORKDIR /workspace
COPY openboard.config.yaml ./
COPY connections/ ./connections/
COPY queries/ ./queries/
COPY theme.yaml ./

# Run the production server (see step 4 for flags).
CMD ["serve", "--no-open", "--port", "3000", "--project", "/workspace"]
```

Keep secrets out of this image. Connection files reference `${ENV_VAR}`
placeholders (step 5), so the image is safe to store in a private registry but
contains no credentials.

## 3. Store dashboards in object storage (recommended)

Baking `.board` files into the image is fine for read-only, git-driven
deployments. But if you want the in-browser editor — so PMs and analysts can
create and edit dashboards without a redeploy — point OpenBoard at an
object-storage bucket instead. Edits are written back to the bucket and persist
across container restarts and image pushes.

OpenBoard supports `s3://` (AWS and S3-compatible stores like MinIO or R2) and
`gs://` (Google Cloud Storage) sources. Enable it with CLI flags:

```bash
openboard serve \
  --no-open \
  --port 3000 \
  --project /workspace \
  --source "s3://your-dashboards-bucket/" \
  --source-writable \
  --source-poll 5 \
  --editor
```

| Flag | Effect |
|---|---|
| `--source s3://bucket/prefix/` | Read `.board` files from object storage instead of the local `dashboards/` dir. |
| `--source-writable` | Allow the editor to write changes back to the bucket. Omit for read-only. |
| `--source-poll 5` | Poll the bucket every N seconds for external changes. |
| `--source-endpoint <url>` | Custom endpoint for S3-compatible stores (MinIO, R2). |
| `--editor` | Enable the browser-based `.board` editor routes. |

Because the bucket becomes the source of truth, the `.board` files in your git
repo are seed material only; after first deploy, treat the bucket as canonical
(it will drift from git as users edit).

**Bucket hardening.** Make the bucket private and durable:

- Block all public access.
- Enable versioning (so an accidental edit or delete is recoverable).
- Enable server-side encryption (e.g. SSE-S3 / AES256).
- Grant the container's role only `s3:GetObject`, `s3:PutObject`,
  `s3:DeleteObject`, and `s3:ListBucket` on that one bucket — nothing broader.

## 4. Run the server: `dev` vs `serve`

| Command | Use |
|---|---|
| `openboard serve` | Production. Starts the HTTP server with no file watcher or hot reload. |
| `openboard dev` | Local development. Same server plus a file watcher and hot reload. |

Both accept the same `--source*` and `--editor` flags. Use `serve` in
containers — there is nothing to watch, and the watcher only adds overhead.

The server listens on `--port` (default `3000`) and binds all interfaces, which
is correct inside a container where the platform controls external exposure.

## 5. Database credentials via environment

Connection YAML references environment variables; the image never contains a
secret:

```yaml
# connections/warehouse.yaml
name: warehouse
type: postgres
host: ${ANALYTICS_DB_HOST}
port: 5432
database: analytics
username: ${ANALYTICS_DB_USER}
password: ${ANALYTICS_DB_PASSWORD}
```

Supply the values at runtime from your platform's secret store. With AWS, fetch
them from SSM Parameter Store or Secrets Manager and inject as environment
variables — for example, a container runtime's "secrets" mapping resolves a
parameter ARN into `ANALYTICS_DB_PASSWORD` at start. The principle is the same
everywhere: secrets live in a secret manager, are injected as env vars, and are
never written to the image or to git.

## 6. Automate deploys with CI

The shipped workflows under [`actions/`](../../actions/) cover validation,
preview, diff, and static deploy. For a container deploy, a minimal GitHub
Actions job builds and pushes the image using short-lived OIDC credentials (no
long-lived keys):

```yaml
name: Deploy OpenBoard
on:
  push:
    branches: [main]
    paths: ["analytics/**"]
  workflow_dispatch:

permissions:
  id-token: write      # for OIDC role assumption
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure cloud credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.DEPLOY_ROLE_ARN }}
          aws-region: <region>

      - name: Resolve registry URL
        id: registry
        run: echo "url=$(your-lookup-command)" >> "$GITHUB_OUTPUT"

      - name: Log in to the registry
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push
        env:
          REPO: ${{ steps.registry.outputs.url }}
          TAG: ${{ github.sha }}
        run: |
          docker build -t "$REPO:live" -t "$REPO:$TAG" analytics/
          docker push "$REPO:live"
          docker push "$REPO:$TAG"
```

Notes:

- Use OIDC role assumption, not stored cloud keys. The only repository secret is
  the role ARN, which is not itself a credential.
- Resolve the registry URL at runtime (from a parameter store or workflow input)
  rather than committing it.
- Tagging both `:live` and `:<sha>` gives you a stable tag for the runtime to
  track and an immutable tag for rollback.
- If your container platform supports auto-deploy on new images, pushing `:live`
  is enough to trigger a rollout.

## Authentication

OpenBoard does not implement login. Instead it trusts an upstream **auth proxy**
to authenticate the user and declare what they may see, via two request headers.
This keeps OpenBoard out of the identity business and lets it plug into whatever
SSO you already run.

### The trusted headers

| Header | Values | Meaning |
|---|---|---|
| `x-openboard-folders` | `*` &#124; `revenue,marketing` &#124; *(empty)* | Which dashboard folders this user may view. `*` is all folders; a CSV is a whitelist; empty is none. |
| `x-openboard-can-edit` | `1` / `true` | Whether this user may use the editor. |

The header names are configurable (via `OPENBOARD_FOLDERS_HEADER` /
`OPENBOARD_CANEDIT_HEADER` env vars, or the `access:` block in config). Enable
enforcement in `openboard.config.yaml`:

```yaml
access:
  enabled: true
  require_folder: true   # hide any root-level dashboard; every board must live in a folder
```

With `require_folder: true`, dashboards must live in business-function folders
(`revenue/`, `support/`, etc.) and a user only sees folders named in their
`x-openboard-folders` header.

> **Security-critical:** the headers are trusted, so the proxy must **strip any
> client-supplied copy** of them on every request before injecting its own
> verified values. If a client can set `x-openboard-folders: *` directly,
> access control is bypassed. Terminate auth at the proxy and never expose
> OpenBoard's port directly.

### The proxy / SSO pattern

A small reverse proxy sits in front of OpenBoard (commonly as a sidecar in the
same container/pod, listening on the public port and forwarding to OpenBoard on
a private one). On each request it:

1. Reads your SSO session token (e.g. a cookie or `Authorization` header).
2. Verifies it against your identity provider — for a JWT, fetch the IdP's JWKS
   (`https://<your-idp>/.well-known/jwks.json`) and verify the signature; for
   OIDC/SAML, use your provider's session.
3. On failure, returns `302` to your login URL (`https://<your-idp>/login`).
4. On success, maps the user's groups/roles to a folder list and edit flag, then
   forwards to OpenBoard with the trusted headers set (and inbound copies
   stripped). Forward WebSocket upgrades too — the editor and live updates use
   them.

A minimal sketch (Node, illustrative — use your real verification):

```js
import http from "node:http";
import httpProxy from "http-proxy";

const proxy = httpProxy.createProxyServer({ target: "http://127.0.0.1:3001", ws: true });
const LOGIN_URL = process.env.LOGIN_URL;

http.createServer((req, res) => {
  // 1. Always remove any client-supplied trusted headers.
  delete req.headers["x-openboard-folders"];
  delete req.headers["x-openboard-can-edit"];

  // 2. Verify the SSO session (replace with real JWKS/OIDC verification).
  const user = verifySession(req);          // -> { folders: ["revenue"], canEdit: true } | null
  if (!user) {
    res.writeHead(302, { Location: LOGIN_URL });
    return res.end();
  }

  // 3. Inject verified identity and proxy through.
  req.headers["x-openboard-folders"] = user.folders.join(",") || "";
  req.headers["x-openboard-can-edit"] = user.canEdit ? "1" : "0";
  proxy.web(req, res);
}).on("upgrade", (req, socket, head) => proxy.ws(req, socket, head)) // WebSockets
  .listen(3000);
```

Run OpenBoard on the private port (`--port 3001`) and the proxy on the public
port (`3000`). Only the proxy is exposed by the platform.

This pattern works with any IdP: an internal SSO hub, Okta, Auth0, Cognito,
Google Workspace, or an OAuth2 proxy such as `oauth2-proxy`. OpenBoard only cares
about the two resulting headers.

## Production checklist

- [ ] Base image built and pushed for the OpenBoard version you run.
- [ ] Project image copies only config/connections/queries/theme — no secrets, no
      baked dashboards (if using a bucket).
- [ ] Dashboard bucket is private, versioned, and encrypted; the container role
      has least-privilege access to it alone.
- [ ] Database credentials come from a secret manager as env vars, never the
      image or git.
- [ ] Server runs `serve` (not `dev`) on the container port.
- [ ] `access.enabled: true` and an auth proxy injects verified headers.
- [ ] The proxy strips client-supplied `x-openboard-*` headers and forwards
      WebSocket upgrades.
- [ ] OpenBoard's own port is not publicly reachable — only the proxy is.
- [ ] CI uses OIDC (no stored cloud keys); registry URL resolved at runtime.

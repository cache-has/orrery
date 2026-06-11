<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# OpenBoard Documentation

Long-form docs for OpenBoard: tutorials, integration guides, and reference material that doesn't fit in the top-level `README.md` or in per-plugin READMEs.

## Layout

```
docs/
  README.md           ← you are here
  guides/             ← task-focused how-tos
  tutorials/          ← step-by-step end-to-end walkthroughs
    assets/           ← pipeline JSON, sample configs, etc. referenced by tutorials
```

As docs grow, add sibling directories for `reference/` (config schemas, CLI reference) and `concepts/` (architecture, design rationale). This file should stay an index.

## Guides

| Guide | What it covers |
|---|---|
| [Deploying OpenBoard](./guides/deployment.md) | Production container deploy: base + project images, S3-backed dashboards, DB credentials, CI/CD, and fronting OpenBoard with your own SSO via the trusted-header auth pattern. |

## Tutorials

| Tutorial | What it covers |
|---|---|
| [From Postgres to Dashboard with Flux + OpenBoard](./tutorials/flux-postgres-to-dashboard.md) | End-to-end Horizon Analytic stack: Pagila in Postgres → Horizon Flux pipeline → openboard sink plugin → OpenBoard dashboard. |

## Plugin docs

Per-plugin docs live with the plugin source, not here. The flux sink plugin's reference is at [`../plugins/flux/README.md`](../plugins/flux/README.md).

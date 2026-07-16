# 10 — GitHub Actions Workflows (Product Offering)

## Goal

Ship a set of GitHub Actions workflows as part of the Orrery product. These are not just for developing Orrery itself — they are workflows that Orrery users copy into their dashboard projects to get CI/CD for their dashboards. This is a key differentiator: dashboards-as-code means dashboards get CI/CD like code.

## Shipped Workflows

### 1. Validate on Pull Request

**File:** `actions/validate.yml`

Runs when a PR touches `.board` or `.yaml` files. Validates all dashboard definitions and connection configs.

```yaml
name: Validate Dashboards
on:
  pull_request:
    paths:
      - 'dashboards/**'
      - 'connections/**'
      - 'queries/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx orrery validate
```

**What `orrery validate` checks:**
- All `.board` files parse without errors
- All connections reference existing env vars (warn if missing in CI — they may be secrets)
- All `file()` references resolve to existing `.sql` files
- All parameter references in SQL match declared params
- Row spans don't exceed 12
- No duplicate dashboard names

### 2. Preview Comment on PR

**File:** `actions/preview.yml`

Generates a static preview of changed dashboards and posts a comment on the PR with screenshots or links.

```yaml
name: Dashboard Preview
on:
  pull_request:
    paths:
      - 'dashboards/**'

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci

      # Start server with mock/sample data for preview
      - name: Generate preview
        run: npx orrery preview --output ./preview
        env:
          # Users configure their DB secrets here or use sample data
          ORRERY_PREVIEW_MODE: true

      # Upload preview as artifact
      - uses: actions/upload-artifact@v4
        with:
          name: dashboard-preview
          path: ./preview

      # Comment on PR with preview link or screenshot
      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const summary = fs.readFileSync('./preview/summary.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: summary
            });
```

**Preview modes:**
- **With database access:** If CI has database credentials (via GitHub Secrets), render with real data
- **Without database access:** Render layout with sample/mock data, showing structure and components but with placeholder charts
- **Screenshot mode:** Use Playwright to capture PNG screenshots of each dashboard

### 3. Deploy to GitHub Pages

**File:** `actions/deploy.yml`

Builds a static export of all dashboards and deploys to GitHub Pages.

```yaml
name: Deploy Dashboards
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Build static dashboards
        run: npx orrery build --output ./dist
        env:
          # Database secrets from GitHub Secrets
          WAREHOUSE_HOST: ${{ secrets.WAREHOUSE_HOST }}
          WAREHOUSE_USER: ${{ secrets.WAREHOUSE_USER }}
          WAREHOUSE_PASSWORD: ${{ secrets.WAREHOUSE_PASSWORD }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 4. Scheduled Cache Warm / Data Refresh

**File:** `actions/refresh.yml`

Runs on a cron schedule to rebuild static dashboards with fresh data.

```yaml
name: Refresh Dashboards
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Build with fresh data
        run: npx orrery build --output ./dist
        env:
          WAREHOUSE_HOST: ${{ secrets.WAREHOUSE_HOST }}
          WAREHOUSE_USER: ${{ secrets.WAREHOUSE_USER }}
          WAREHOUSE_PASSWORD: ${{ secrets.WAREHOUSE_PASSWORD }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist
      - uses: actions/deploy-pages@v4
```

### 5. Dashboard Diff on PR

**File:** `actions/diff.yml`

Compares dashboards between the PR branch and main, highlighting what changed.

```yaml
name: Dashboard Diff
on:
  pull_request:
    paths:
      - 'dashboards/**'

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Generate diff report
        run: npx orrery diff --base origin/main --head HEAD --output ./diff-report.md
      - name: Comment diff
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const diff = fs.readFileSync('./diff-report.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: diff
            });
```

**Diff output shows:**
- New dashboards added
- Dashboards removed
- Changed queries (SQL diff)
- Changed layout (component added/removed/reordered)
- Changed parameters

## CLI Commands Supporting Actions

These CLI commands are what the GitHub Actions call. They must work in headless/CI mode:

| Command | Purpose |
|---------|---------|
| `orrery validate` | Parse and validate all `.board` and connection files |
| `orrery build --output ./dist` | Static export of all dashboards |
| `orrery preview --output ./preview` | Generate preview artifacts |
| `orrery diff --base REF --head REF` | Compare dashboards between git refs |

## User Setup Documentation

Users need clear docs on:
1. Copy workflow files to `.github/workflows/` in their dashboard project
2. Add database credentials as GitHub Secrets
3. Enable GitHub Pages (if using deploy workflow)
4. Customize cron schedule for refresh workflow

The `create-orrery` scaffolding tool should offer to set up these workflows during project creation.

## Acceptance Criteria

- [x] `validate.yml` runs on PR and catches `.board` parse errors
- [x] `preview.yml` generates preview and comments on PR (workflow created; `orrery preview` command deferred to phase 11)
- [x] `deploy.yml` builds static export and deploys to GitHub Pages (workflow created; `orrery build` command deferred to phase 11)
- [x] `refresh.yml` rebuilds on a cron schedule (workflow created; depends on `orrery build` from phase 11)
- [x] `diff.yml` shows structured diff of dashboard changes on PR
- [x] `orrery validate` exits with code 1 on errors (CI-compatible); auto-discovers .board files
- [x] `orrery diff` produces readable markdown diff output

### Deferred to later phases

- `orrery build` works in headless mode with env var credentials → phase 11 (static export)
- `orrery preview` CLI command → phase 11 (depends on build/static rendering)
- `create-orrery` offers to scaffold workflow files → phase 14 (packaging/distribution)
- Documentation covers GitHub Secrets setup for database credentials → phase 15 (documentation)

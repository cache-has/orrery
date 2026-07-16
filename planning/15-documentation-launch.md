# 15 — Documentation & Launch

## Goal

Write clear, practical documentation and execute a launch that gets Orrery in front of its target audience: engineers and PMs who are frustrated with GUI BI tools and want dashboards-as-code.

## Documentation

### Documentation Site

Host on GitHub Pages or a docs platform (Starlight/Astro, VitePress, or similar). Prioritize clarity over comprehensiveness — a short doc that gets someone running in 5 minutes beats a complete reference nobody reads.

### Documentation Structure

```
docs/
  getting-started.md          # 5-minute quickstart
  dsl-reference.md            # Complete .board language reference
  connections.md              # Database connection setup
  components.md               # Component reference (charts, tables, metrics, text)
  parameters.md               # Interactive filters and parameters
  theming.md                  # Customization and branding
  github-actions.md           # CI/CD workflow setup
  deployment.md               # Deployment options (Pages, Docker, self-hosted)
  examples/
    sales-dashboard.md        # Walk-through: building a sales dashboard
    ops-dashboard.md          # Walk-through: building an ops dashboard
    multi-db-dashboard.md     # Walk-through: dashboard with multiple data sources
  faq.md                      # Common questions and troubleshooting
```

### Getting Started (Critical Path)

This page must get someone from zero to a running dashboard in under 5 minutes:

```markdown
# Getting Started

## 1. Create a project

    npm create orrery my-dashboards
    cd my-dashboards

## 2. Add your database credentials

    cp .env.example .env
    # Edit .env with your database host, user, password

## 3. Start the dev server

    npx orrery dev

## 4. Open http://localhost:3000

You should see the example dashboard. Edit `dashboards/example.board` —
the browser updates automatically.

## 5. Next steps

- [DSL Reference](./dsl-reference.md) — full language spec
- [Components](./components.md) — charts, tables, metrics
- [Parameters](./parameters.md) — interactive filters
- [GitHub Actions](./github-actions.md) — CI/CD for your dashboards
```

### DSL Reference

Complete reference for the `.board` language, organized by construct:
- Dashboard block
- Parameters (each type with examples)
- Rows and layout
- Components (each type with all properties)
- Includes
- File references
- Conditional visibility

Each construct: syntax, properties, defaults, and a working example.

### Examples Repository

A separate GitHub repo (`orrery/examples`) with:
- `sales-dashboard/` — Classic sales analytics
- `ops-dashboard/` — Infrastructure monitoring
- `marketing-dashboard/` — Campaign analytics with multiple data sources
- `sqlite-demo/` — Self-contained demo with SQLite (no external DB needed)

The SQLite demo is critical for try-before-you-commit. Someone can clone it and run it immediately.

## Launch Strategy

### Phase 1: Soft Launch (Week 1-2)

- Publish to npm as 0.1.0
- GitHub repo public with README, LICENSE, CONTRIBUTING
- Post on personal social channels
- Share with 5-10 people for early feedback
- Fix critical issues from first users

### Phase 2: Community Launch (Week 3-4)

- Hacker News "Show HN" post
- Reddit: r/programming, r/dataengineering, r/BusinessIntelligence
- Dev.to / Hashnode blog post: "Why I built dashboards-as-code"
- Twitter/X thread showing before/after (Evidence.dev → Orrery)
- Discord or GitHub Discussions for community

### Phase 3: Sustained Growth

- Blog posts: tutorials, use cases, comparison with alternatives
- Conference talks / meetup presentations (data engineering meetups)
- Integration guides: "Orrery + dbt", "Orrery + Airbyte"
- YouTube: short demo video (< 3 min)
- GitHub Sponsors for sustainable development

### Messaging

**Core message:** "Dashboards as code. Define in a DSL, query with SQL, version with git, deploy with GitHub Actions."

**Anti-messages (what we're not):**
- Not a Tableau/Looker replacement (we're for engineers, not business analysts)
- Not a data modeling tool (pair with dbt for that)
- Not a real-time streaming dashboard (use Grafana for that)

**Positioning statement:** "Orrery is for teams that want their dashboards to live in git, deploy via CI/CD, and never touch a drag-and-drop builder again."

## README Structure

```markdown
# Orrery

Dashboards as code. Define in a DSL, query with SQL, version with git.

[screenshot/gif of a dashboard]

## Quick Start
[4 commands to get running]

## Why Orrery?
[3-4 bullet comparison with Evidence, Metabase, Superset]

## Example
[Short .board file example → screenshot of rendered output]

## Documentation
[Links]

## Contributing
[Link to CONTRIBUTING.md]

## License
MIT
```

## Acceptance Criteria

- [ ] Documentation site deployed and accessible
- [ ] Getting Started guide takes < 5 minutes to complete
- [ ] DSL reference covers every language construct
- [ ] Component reference with examples for each component type (must cover all chart types: line, bar, area, donut/pie, scatter+bubble, heatmap, funnel, gauge, stacked bar — deferred from plan 19)
- [ ] SQLite self-contained demo repo works with zero external dependencies
- [ ] README has screenshot/gif, quick start, and example
- [ ] npm package published and installable
- [ ] Documentation covers GitHub Secrets setup for database credentials in CI/CD workflows (deferred from phase 10)
- [ ] Show HN post drafted
- [ ] Blog post drafted

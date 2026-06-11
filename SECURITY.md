# Security Policy

## Supported Versions

OpenBoard is pre-1.0 and under active development. Security fixes are applied to
the latest `main` and the most recently published release.

## Reporting a Vulnerability

Please do not open public issues, discussions, or pull requests for security
vulnerabilities. Public disclosure before a fix is available puts users at risk.

Report privately through one of these channels:

- GitHub private vulnerability reporting: open the repository's "Security" tab
  and choose "Report a vulnerability". This is the preferred channel.
- Email the maintainer: Cache McClure, cache@horizonanalyticstudios.com.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- The affected version, commit, or branch.

You can expect an initial response within five business days. Once a fix is
ready, we will coordinate a disclosure timeline with you and credit you unless
you prefer to remain anonymous.

## Scope

OpenBoard executes user-defined SQL against user-configured database connections
and renders dashboards from `.board` files. Reports in these areas are of
particular interest:

- Injection or sandbox escape via the `.board` DSL or query parameters.
- Leakage of credentials or environment variables.
- Path traversal in the filesystem- or S3-backed dashboard store.
- Authentication or authorization bypass in the browser-based editor.
- Privilege escalation in the shipped GitHub Actions workflows.

## A Note on the Shipped GitHub Actions

The workflow templates under `actions/` are part of the product and are copied
into downstream dashboard repositories. Treat changes to them with the same care
as application code: a malicious change there runs in other people's repositories.

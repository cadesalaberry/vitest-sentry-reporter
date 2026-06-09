# Architectural Decision Records (ADR)

This directory contains Architectural Decision Records using MADR (Markdown Architectural Decision Records).

- Format: MADR. See the docs at [adr.github.io/madr](https://adr.github.io/madr/) and the repository at [github.com/adr/madr](https://github.com/adr/madr).
- Template: `adr-template.md`
- Each ADR carries its metadata (`title`, `status`, `date`, `authors`) in YAML front matter, followed by `## Context`, `## Decision`, and `## Consequences` sections.

## Index

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [0000](0000-use-markdown-architectural-decision-records.md) | Use Markdown Architectural Decision Records (MADR) | accepted | 2025-09-03 |
| [0001](0001-adopt-bun-as-package-manager.md) | Adopt Bun as the package manager and runtime | accepted | 2025-09-03 |
| [0002](0002-add-dry-run-transport.md) | Add dry-run transport to log Sentry envelopes instead of sending | accepted | 2025-09-04 |
| [0003](0003-commit-conventions.md) | Adopt Conventional Commits and Gitmoji | accepted | 2025-11-25 |
| [0004](0004-migrate-to-vitest-4-reported-tasks-api.md) | Migrate the reporter to the Vitest 4 reported-tasks API | accepted | 2026-06-07 |
| [0005](0005-support-vitest-3.md) | Support Vitest 3 by relaxing the peer dependency range | accepted | 2026-06-07 |
| [0006](0006-automate-releases-with-release-please.md) | Automate releases with release-please and Conventional Commits | accepted | 2026-06-08 |

ADRs are numbered sequentially in the chronological order in which they were decided.

## How to create a new ADR

1. Choose the next zero-padded number (e.g., `0007`).
2. Copy the template:

```
cp adr-template.md 0007-short-title.md
```

3. Fill in the front matter (`title`, `status`, `date`, `authors`) and the `## Context` / `## Decision` / `## Consequences` sections.
4. Add a row to the [Index](#index) above.
5. Commit the ADR following the project [commit convention](../COMMIT_CONVENTION.md), e.g. `docs(adr): 📝 add ADR for X`.

## Front matter

```yaml
---
title: Short imperative title
status: proposed
date: YYYY-MM-DD
authors:
  - your-github-handle
---
```

## Naming

- File name: `NNNN-short-title.md` where `NNNN` is the zero-padded sequence number.
- Title: Use a short imperative phrase.

## Status values

- `proposed`: Under discussion
- `accepted`: Agreed and to be implemented (or already implemented)
- `rejected`: Considered but not adopted
- `deprecated`: No longer recommended for new work
- `superseded`: Replaced by another ADR (link the successor)

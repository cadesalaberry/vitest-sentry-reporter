---
title: Adopt Biome for linting and formatting
status: accepted
date: 2026-06-09
authors:
  - cadesalaberry
---

## Context

The project had no linter or formatter. Code style was maintained by convention
and reviewer diligence (`AGENTS.md` documents the intended style), but nothing
enforced it. This is friction for contributors, who cannot tell whether their
code matches the project's style until review, and it lets inconsistent
formatting creep in.

We want automated, enforced linting and formatting that:

- Is fast and needs minimal configuration.
- Adds as few dependencies as possible — the project deliberately keeps its
  dependency footprint small (see `AGENTS.md`) and uses Bun (ADR-0001).
- Covers both linting and formatting, so we do not have to wire up and reconcile
  two separate tools (e.g. ESLint + Prettier).

## Decision

Adopt [Biome](https://biomejs.dev) as the single tool for both linting and
formatting.

- Configuration lives in `biome.json`. The formatter matches the existing style
  (2-space indentation, single quotes) to avoid a large reformat, and respects
  `.gitignore` via Biome's VCS integration.
- Scripts: `bun run check` (lint + format check, used by CI), `bun run check:fix`
  (auto-fix), and `bun run format`.
- CI runs `biome ci .` in a dedicated quality job.
- A `pre-commit` hook (via [lefthook](https://lefthook.dev), introduced alongside
  this change) runs Biome on staged files so issues are caught before CI.

Biome was chosen over ESLint + Prettier because it is a single fast binary (one
dev dependency instead of several), needs little configuration, and aligns with
the project's minimal-dependency, Bun-based toolchain.

## Consequences

- Style is enforced automatically and consistently; contributors get instant,
  local feedback from the pre-commit hook and from `bun run check`.
- Only one dev dependency (`@biomejs/biome`) is added for lint + format, plus
  `lefthook` for git hooks.
- Adopting Biome reformats the existing codebase once; that change is landed as a
  dedicated `style:` commit to keep it reviewable.
- Biome's rule set differs from ESLint's. Some ESLint-specific rules and plugins
  are unavailable; if a needed rule is missing, we revisit this decision.
- Markdown and YAML are not formatted by Biome; those remain manually maintained.

## References

- Biome: https://biomejs.dev
- Biome linter rules: https://biomejs.dev/linter/rules/
- lefthook: https://lefthook.dev
- ADR-0001: Adopt Bun as the package manager and runtime
- `AGENTS.md`

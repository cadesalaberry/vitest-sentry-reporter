# Use Markdown Architectural Decision Records (MADR)

- Status: accepted
- Date: 2025-09-03

## Context

We want a consistent, lightweight, and review-friendly way to document architectural decisions for `vitest-sentry-reporter`. An ADR format helps capture context, options, and outcomes over time.

## Decision

Adopt MADR (Markdown Architectural Decision Records) as our ADR format and process.

- Store ADRs under `docs/decisions`
- Use sequential, zero-padded numbering: `NNNN-short-title.md`
- Start new ADRs from `docs/decisions/adr-template.md`
- Use statuses: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded`
- When an ADR is superseded, link the successor in both directions

## Consequences

- Clear, searchable history of decisions and their rationale
- Easier onboarding and code reviews through explicit rationale
- Small process overhead when proposing significant changes

## References

- MADR documentation: https://adr.github.io/madr/
- MADR repository: https://github.com/adr/madr

# AGENTS.md

A dedicated guide for coding agents working on `vitest-sentry-reporter`. See the format rationale at [agents.md](https://agents.md/).

## Project overview

- Library: Vitest reporter that sends failures/context to Sentry.
- Runtime: Node >= 18; ESM output.
- Package manager: Bun (see `engines.bun`).
- Entry points: `src/index.ts` → builds to `dist/index.js`; type declarations emit to `dist/index.d.ts`.

## Setup commands

- Install deps: `bun install`
- Build library: `bun run build`
- Run tests (placeholder until tests are added): `bun run test run`
- Prepare step (informational): `bun run prepare`

## Dev workflow tips

- Source lives in `src/`; build emits to `dist/` via Bun bundler (`bun build`).
- Type declarations are emitted to `dist/` by `tsc --emitDeclarationOnly` and referenced by `package.json` `types` (`dist/index.d.ts`).
- Keep the build green before publishing; `prepublishOnly` runs the build automatically.

## Code style and conventions

- TypeScript, ESM modules.
- Favor explicit types for public APIs and meaningful, descriptive names.
- Use early returns, shallow control flow, and avoid swallowing errors.
- Keep formatting consistent with existing files (single quotes are preferred where practical).
- Avoid adding dependencies unless necessary; prefer small, focused utilities.

## Commit message conventions

- Strictly follow the conventions defined in [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md).
- Use [Conventional Commits](https://www.conventionalcommits.org/) with a Gitmoji placed immediately before the description.

## Testing instructions

- Test runner: Vitest (already a dev dependency). No tests exist yet.
- When adding tests:
  - Prefer lace unit tests alongside source.
  - Prefer fast, deterministic tests with clear assertions.
  - You can invoke Vitest directly if needed: `bun run test run --reporter=dot`

## Security considerations

- Do not commit secrets; Sentry DSN and related config should be passed via environment variables in consuming projects.
- Reporter code should handle missing or invalid configuration gracefully and never throw in a way that breaks the test runner.

## PR checklist (for agents)

- Build succeeds: `bun run build`.
- Tests pass (once present): `bun run test run`.
- Types are accurate and exported via `dist/index.d.ts`.
- Keep changes minimal; update docs if behavior changes.

## Release notes

- Releases are automated with release-please from Conventional Commits. Do not bump `version` in `package.json` or edit `CHANGELOG.md` by hand — release-please maintains both via a release PR.
- Merging the release PR tags `vX.Y.Z`, creates a GitHub release, and publishes to npm with provenance (`.github/workflows/release.yml`).
- The version bump is derived from commit types: `feat` → minor, `fix` → patch, `!`/`BREAKING CHANGE:` → major. Use the correct type so the bump is correct.
- See `docs/decisions/0006-automate-releases-with-release-please.md` for details and required repo setup (npm Trusted Publishing, PR-creation permission).

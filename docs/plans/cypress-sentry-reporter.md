# Plan: `cypress-sentry-reporter` — a standalone sibling repo

Create a new repository, `cadesalaberry/cypress-sentry-reporter`, that does for
Cypress what this repo does for Vitest: report failing end-to-end tests to
Sentry with rich, consistent tags.

**Hard constraint:** the two repos must have **no link**. Neither imports the
other, no shared npm package, no git submodule. Shared logic is **copied** into
the new repo and allowed to evolve independently.

## 1. Architecture decision: plugin hooks, not a Mocha reporter

Cypress "custom reporters" are Mocha reporters, but the recommended integration
point for this package is Cypress's **`setupNodeEvents` plugin API** instead:

- `after:spec` delivers a structured results object per spec (tests, attempts,
  `displayError`, durations) in the Node process, where `@sentry/node` works.
- Plugin hooks can return a promise, so `Sentry.flush()` can complete reliably
  before the process exits. Mocha's reporter `done` callback inside Cypress is
  fragile by comparison.
- `before:run` exposes browser and Cypress version metadata that a Mocha
  reporter never sees.
- All specs in a `cypress run` share one Node plugin process, so run-level
  state (`maxEventsPerRun` cap, dedup) works naturally across specs.

Public API:

```ts
// cypress.config.ts
import { defineConfig } from 'cypress';
import { registerCypressSentryReporter } from 'cypress-sentry-reporter';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      registerCypressSentryReporter(on, config, {
        // same option surface as vitest-sentry-reporter:
        // dsn, enabled, environment, release, serverName, tags,
        // sentryOptions, shouldReport, getTags, getFingerprint,
        // getUser, beforeSend, maxEventsPerRun, dryRun
      });
      return config;
    },
  },
});
```

A classic Mocha-reporter entry point can be added later as a secondary export
if users ask for it; it is explicitly out of scope for v1.

Record this as the new repo's first real ADR
("0001 — integrate via plugin events instead of a Mocha reporter").

## 2. What gets copied verbatim (framework-neutral code)

These modules contain no Vitest types and port with only cosmetic renames:

| Source (this repo) | Notes |
|---|---|
| `src/ci-providers/*` | unchanged (GitHub, GitLab, CircleCI, Buildkite, Jenkins, generic) + tests |
| `src/actor-detectors/*` | unchanged logic; rename env markers `VITEST_SENTRY_ACTOR_TYPE/NAME` → `CYPRESS_SENTRY_ACTOR_TYPE/NAME` |
| `src/dry-run-transport.ts` | unchanged + tests |
| `src/types.ts` | `FailureContext` and options type are already runner-agnostic; rename `VitestSentryReporterOptions` → `CypressSentryReporterOptions` |
| `src/utils.ts` | keep `cleanRecord`, `baseTags`, `extras`, `detectTrigger`, CI helpers; drop `toFailureContext`/`collectSuitePath` (Vitest-specific); rename `VITEST_SENTRY_TRIGGER` → `CYPRESS_SENTRY_TRIGGER` |
| `src/reporter.ts` (lines ~109–247) | `reportFailure` + `initSentry` + `resolveEnabled` become a runner-neutral `core.ts`; default fingerprint prefix `vitest-failure` → `cypress-failure` |

Note: Cypress copies `CYPRESS_*` env vars into `Cypress.env()`, but they remain
readable via `process.env` in the plugin process, so the `CYPRESS_SENTRY_*`
names are safe.

## 3. What is new (the Cypress adapter)

```
src/
├── index.ts             # registerCypressSentryReporter + re-exports
├── plugin.ts            # wires before:run / after:spec / after:run
├── core.ts              # ported reportFailure / initSentry (Sentry side)
├── map-results.ts       # CypressCommandLine.RunResult → FailureContext[]
├── types.ts / utils.ts / dry-run-transport.ts
├── ci-providers/        # copied
└── actor-detectors/     # copied
```

`plugin.ts` behavior:

- `before:run (details)` — capture `details.browser` (name/version) and
  `details.cypressVersion` into run-scoped state.
- `after:spec (spec, results)` — map each test whose final state is `failed`
  to a `FailureContext` and report immediately (so a crash later in the run
  doesn't lose earlier failures). Apply `shouldReport`, dedup, and the
  `maxEventsPerRun` cap here.
- `after:run` — final defensive sweep over run results, then
  `await Sentry.flush(3000)`.

`map-results.ts` field mapping:

| `FailureContext` | Cypress source (`after:spec` results) |
|---|---|
| `filePath` | `spec.relative` |
| `testName` | last element of `test.title[]` |
| `fullTitle` | `test.title.join(' > ')` |
| `suitePath` | `test.title.slice(0, -1)` |
| `message` / `stack` | parsed from `test.displayError` (first line = message, rest = stack) |
| `durationMs` | `test.duration` (fallback: sum of attempt durations) |
| `retry` | `test.attempts.length - 1` |
| `flaky` | final state `passed` with a prior failed attempt (Cypress test retries) |
| `logs` | not available from plugin events in v1 — document as a limitation |

Known constraint: since Cypress 13 the module-API results expose reduced
per-attempt detail (state only) and a single `displayError` per test. That is
sufficient for everything above; note it in the README.

## 4. Tag parity with vitest-sentry-reporter

All environment-derived tags come from `process.env` and carry over
**unchanged**: `ci`, `trigger`, `actor_type`, `actor_name`, `repository`,
`branch`, `commit_sha`, `node_version`, `os_platform`, `os_release`, `flaky`,
`retry`, plus user `tags`/`getTags`. Differences:

| Tag/extra | vitest-sentry-reporter | cypress-sentry-reporter |
|---|---|---|
| `reporter` | `vitest-sentry-reporter` | `cypress-sentry-reporter` |
| `test_file` | module path | spec relative path |
| extra `vitest_version` | ✅ | replaced by `cypress_version` |
| `browser_name`, `browser_version` | — | new (from `before:run`) |
| default fingerprint | `['vitest-failure', file, test]` | `['cypress-failure', spec, test]` |

So events from both repos land in Sentry with near-identical shape and can be
queried/dashboarded together (e.g. `reporter:* test_file:*`).

## 5. Repo scaffolding (mirror this repo's conventions, fresh history)

- `git init` from scratch — no fork, no shared history, no remote pointing here.
- Copy and adapt: `package.json` (new name/description/keywords `cypress`,
  `reporter`, `sentry`, `e2e`; same scripts), `tsconfig.json`, `biome.json`,
  `lefthook.yml`, `.editorconfig`, `.nvmrc`, `.gitignore`,
  `release-please-config.json` + manifest (start at `0.1.0`), `codecov.yml`,
  `scripts/validate-pr-title.ts` + `validate-commit-msg.ts`,
  `.github/` (CI, release, pr-title workflows, templates, dependabot,
  CODEOWNERS), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `SUPPORT.md`, `AGENTS.md`, MIT `LICENSE`.
- `docs/decisions/`: start numbering fresh; port only the generic ADRs
  (markdown ADRs, Bun, dry-run transport, commit conventions, release-please,
  Biome) rewritten for the new repo, plus the new plugin-vs-reporter ADR.
- Dependencies: peer `@sentry/node >= 10` and `cypress >= 13`; dev deps mirror
  this repo (bun, biome, typescript, lefthook, release-please via CI) **plus**
  `cypress` and `vitest` as dev-only tools. Using Vitest as the unit-test
  runner is a tooling choice and does not link the repos.

## 6. Testing strategy

1. **Unit tests (Vitest, ported + new):** ci-providers, actor-detectors,
   dry-run transport, utils tests come across nearly as-is. New tests for
   `map-results.ts` using fixture `after:spec` payloads (failed, retried-flaky,
   retried-failed, skipped) and for `plugin.ts` using a fake `on()` registrar.
2. **E2E smoke test (real Cypress, dry-run mode):** an `e2e/` fixture project
   with one passing and one deliberately failing spec; CI job runs
   `cypress run` with `dryRun: true` and asserts the logged envelope contains
   the expected tags. This is the equivalent of this repo's `test:dogfood`.
3. **CI matrix** over supported Cypress majors (13, 14, latest) instead of the
   Vitest matrix; keep the lint/build/publint/attw job and Codecov upload.
   Cache the Cypress binary (`~/.cache/Cypress`) keyed on the matrix version.

## 7. Delivery phases

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Repo bootstrap: scaffolding, configs, CI skeleton, LICENSE, empty `src/` | CI green on a hello-world build |
| 1 | Port neutral core: types, utils, ci-providers, actor-detectors, dry-run transport, `core.ts` + ported unit tests | unit tests green |
| 2 | Cypress adapter: `plugin.ts`, `map-results.ts`, `index.ts` exports | mapping unit tests green |
| 3 | E2E smoke fixture + dry-run assertion job in CI | failing spec produces expected envelope in CI |
| 4 | README (mirroring this repo's tone: why, install, usage, options table, tag reference), ADRs, CHANGELOG seed | docs reviewed |
| 5 | release-please + npm trusted publishing wired; `v0.1.0` published | package installable, smoke-tested against a real Sentry DSN |

## 8. Risks & open items

- **npm name availability:** verify `cypress-sentry-reporter` is free on npm
  before Phase 0; fall back to a scoped name if squatted.
- **`after:spec` in open mode:** plugin run events only fire in `cypress run`
  (or with `experimentalInteractiveRunEvents`). Acceptable — CI is the target —
  but document it.
- **Component testing:** the same `setupNodeEvents` registration works for the
  `component` config block; add a `test_type: e2e|component` tag derived from
  `config.testingType`.
- **Console logs:** not exposed via plugin events; if demand exists, a later
  minor can add an optional support-file task that forwards `cy.log`/console
  output.
- **Drift policy:** because the repos are intentionally unlinked, fixes to
  ci-providers/actor-detectors must be manually mirrored. Add a note in both
  repos' `CONTRIBUTING.md` pointing at the sibling, nothing more.

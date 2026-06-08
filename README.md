# vitest-sentry-reporter

[![codecov](https://codecov.io/gh/cadesalaberry/vitest-sentry-reporter/graph/badge.svg)](https://codecov.io/gh/cadesalaberry/vitest-sentry-reporter)

Uses Sentry to collect software defects and orchestrate its correction.

## Why report failing Vitest tests to Sentry

- **Faster feedback**: Centralizes failures from CI and local runs for immediate visibility.
- **Actionable context**: Captures stack traces, release, commit SHA, env, and custom tags.
- **Ownership & triage**: Deduplicates, routes to the right team, and suppresses known flakes.
- **Trend & flake insights**: Surfaces regressions and flaky patterns to improve reliability.
- **Shift-left quality**: Treats test failures as first-class defects, not console noise.
- **Production parity**: Mirrors proven prod observability practices in pre-merge pipelines.
- **Continuous improvement**: Dashboards and alerts drive SLIs/SLOs for test health.

Good teams observe production. Great teams also observe their tests.

## Installation

```bash
bun add -D vitest-sentry-reporter @sentry/node
```

## Usage

Add the reporter to your `vitest.config.ts`.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import VitestSentryReporter from 'vitest-sentry-reporter';

export default defineConfig({
  test: {
    reporters: [
      new VitestSentryReporter({
        // If omitted, uses process.env.SENTRY_DSN
        // dsn: process.env.SENTRY_DSN,

        // Enable/disable explicitly. Defaults to enabled if DSN exists.
        // enabled: true,

        // Optional metadata; will fall back to env and CI info if omitted
        environment: process.env.SENTRY_ENVIRONMENT || 'ci',
        release: process.env.SENTRY_RELEASE, // defaults to commit SHA on popular CIs
        serverName: 'local-dev',
        tags: {
          project: 'my-repo', // useful when used across multiple repos
          team: 'qa',
        },

        // Sentry SDK options
        sentryOptions: {
          // debug: true,
        },

        // Filter which failures are reported
        shouldReport: (ctx) => !ctx.flaky,

        // Add or override tags dynamically per failure
        getTags: (ctx) => ({
          spec: ctx.filePath,
          retry: String(ctx.retry ?? 0),
        }),

        // Stable grouping across repos
        getFingerprint: (ctx) => [
          'vitest-failure',
          ctx.filePath ?? 'unknown-file',
          ctx.testName,
        ],

        // Associate a user to help spot who hit the failure locally
        getUser: () => ({ username: process.env.USER }),

        // Mutate the final Sentry event before it is sent
        beforeSend: (event, _hint, ctx) => {
          event.level = 'error';
          event.tags = { ...(event.tags || {}), quicklook: 'true' };
          event.extra = { ...(event.extra || {}),
            suite_path: ctx.suitePath,
            duration_ms: ctx.durationMs,
          };
          return event;
        },

        // Safety valve in large suites
        maxEventsPerRun: 200,

        // If true, logs what would be sent without sending to Sentry
        // dryRun: true,
      })
    ],
  },
});
```

Compatible with Vitest 3 and 4.

### What gets reported

- **Error**: The thrown error from the failed test (or synthesized from message).
- **Tags**: `test_file`, `test_name`, `test_full_title`, `flaky`, `retry`, `node_version`, `os_platform`, `os_release`, `ci`, `repository`, `branch`, `commit_sha`, plus any custom tags.
- **Extras**: `duration_ms`, `logs`, `suite_path`, `vitest_version`, minimal CI env snapshot.
- **Contexts**: `test` context with file/name/fullTitle/duration/retry/flaky.
- **Fingerprint**: Defaults to `['vitest-failure', file, testName]`; override with `getFingerprint`.

### Environment variables and CI auto-detection

- `SENTRY_DSN` (required unless `dsn` is provided)
- `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` are respected when not explicitly set.
- CI metadata auto-detected for GitHub Actions, CircleCI, Buildkite, GitLab, Jenkins.

### Multi-repo usage

Use the `tags.project` field and/or `getTags` to inject a stable project identifier. You can also add a `repository` tag if you aggregate across multiple repos.

### License

MIT

## Architectural Decision Records (ADR)

We record architectural decisions using MADR (Markdown Architectural Decision Records).

- **Directory**: `docs/decisions`
- **Template**: `docs/decisions/adr-template.md`
- **Format**: MADR. See the docs at [adr.github.io/madr](https://adr.github.io/madr/) and the repository at [github.com/adr/madr](https://github.com/adr/madr).

### Create a new ADR

1. Pick the next number (zero-padded), e.g., `0001`.
2. Copy the template and edit:

```
cp docs/decisions/adr-template.md docs/decisions/0001-short-title.md
```

3. Fill in the sections and set an appropriate status (`proposed`, `accepted`, `rejected`, `superseded`).

The initial ADR adopting MADR lives at `docs/decisions/0000-use-markdown-architectural-decision-records.md`.

## Releasing

Releases are automated from [Conventional Commits](https://www.conventionalcommits.org/)
using [release-please](https://github.com/googleapis/release-please). You do not
bump the version or edit `CHANGELOG.md` by hand.

How it works:

1. Merge your work into `main` using Conventional Commit messages (see
   `docs/COMMIT_CONVENTION.md`). `feat:` → minor, `fix:` → patch,
   `!`/`BREAKING CHANGE:` → major.
2. release-please opens (and keeps updating) a **release PR** that bumps
   `version` in `package.json` and updates `CHANGELOG.md`.
3. Merge the release PR when you want to ship. That creates the `vX.Y.Z` git tag
   and a GitHub release, and automatically publishes the package to npm with
   provenance.

Configuration lives in `release-please-config.json` and the current released
version is tracked in `.release-please-manifest.json`. See
`docs/decisions/0004-automate-releases-with-release-please.md` for the rationale.

### One-time repository setup

- Add an **`NPM_TOKEN`** secret (an npm automation/granular token with publish
  access) under Settings → Secrets and variables → Actions.
- Enable **Allow GitHub Actions to create and approve pull requests** under
  Settings → Actions → General → Workflow permissions, so release-please can
  open its release PR.


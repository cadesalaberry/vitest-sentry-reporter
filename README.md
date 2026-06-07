# vitest-sentry-reporter

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

Compatible with Vitest 2+.

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


# vitest-sentry-reporter

[![npm version](https://img.shields.io/npm/v/vitest-sentry-reporter.svg)](https://www.npmjs.com/package/vitest-sentry-reporter)
[![npm downloads](https://img.shields.io/npm/dm/vitest-sentry-reporter.svg)](https://www.npmjs.com/package/vitest-sentry-reporter)
[![CI](https://github.com/cadesalaberry/vitest-sentry-reporter/actions/workflows/ci.yml/badge.svg)](https://github.com/cadesalaberry/vitest-sentry-reporter/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/cadesalaberry/vitest-sentry-reporter/graph/badge.svg)](https://codecov.io/gh/cadesalaberry/vitest-sentry-reporter)
[![License: MIT](https://img.shields.io/npm/l/vitest-sentry-reporter.svg)](LICENSE)

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

        // Stable grouping across repos (this is also the default).
        // `relativeFilePath` is the repo-root-relative path, so a failure
        // groups the same way whether it ran locally or in CI.
        getFingerprint: (ctx) => [
          'vitest-failure',
          ctx.relativeFilePath ?? ctx.filePath ?? 'unknown-file',
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
- **Tags**: `test_file` (repo-relative path, see below), `test_name`, `test_full_title`, `test_project` (Vitest project/workspace name, handy for monorepos), `flaky`, `retry`, `node_version`, `os_platform`, `os_release`, `ci`, `trigger`, `actor_type`, `actor_name`, `job_name` (CI job/step/shard name), `repository`, `branch`, `commit_sha`, `run_url` (link to the CI run/build, when detected), plus `code_owners`/`code_owner` when CODEOWNERS resolution is enabled, plus any custom tags.
- **Extras**: `duration_ms`, `logs`, `suite_path`, `vitest_version`, minimal CI env snapshot.
- **Contexts**: `test` context with file/name/fullTitle/duration/retry/flaky; in CI, a `ci` context with direct triage links — `pull_request_url`, `run_url`, `commit_url`, and `workflow_id` — for whichever the detected provider exposes. Sentry renders these URLs as clickable links, so the failing run, pull request and commit are one click from the issue.
- **Fingerprint**: Defaults to `['vitest-failure', repoRelativeFile, testName]`; override with `getFingerprint`.

#### Repo-relative `test_file` and grouping

The `test_file` tag and the default fingerprint use the test file's path
**relative to the repository root** (with `/` separators), rather than the
absolute path Vitest reports. Absolute paths differ between a local checkout
(e.g. `/Users/you/repo/src/x.test.ts`) and CI
(e.g. `/home/runner/work/repo/repo/src/x.test.ts`), which would otherwise split
the same failure into separate Sentry issues. Relativizing them means a failure
groups identically across local and CI runs. The repository root is the detected
CI checkout path (falling back to `process.cwd()`), and the absolute path is
still available on the `test` context and as `ctx.filePath`. Provide
`getFingerprint` to fully control grouping.

### Trigger and actor detection (CI vs manual, human vs bot vs AI)

Every failure is tagged with how the run was started and who (or what) started it:

- **`trigger`**: `ci` when a CI provider is detected, `manual` otherwise.
- **`actor_type`**: `human`, `bot`, or `ai`.
- **`actor_name`**: the specific actor, e.g. `claude-code`, `cursor`, `github-copilot`, `openai-codex`, `dependabot`, `renovate` — or `human`.

Out of the box the reporter recognizes:

| Actor | `actor_type` | Markers |
|---|---|---|
| Claude Code | `ai` | `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` |
| Cursor | `ai` | `CURSOR_AGENT` |
| GitHub Copilot coding agent | `ai` | `GITHUB_ACTOR=copilot-swe-agent[bot]` |
| OpenAI Codex | `ai` | `CODEX_SANDBOX`, `CODEX_PROXY_CERT` |
| Gemini CLI | `ai` | `GEMINI_CLI` |
| opencode | `ai` | `OPENCODE`, `OPENCODE_BIN_PATH` |
| Any agent advertising itself | `ai` | `AI_AGENT`, `AGENT` (reported as `actor_name`) |
| Dependabot / Renovate | `bot` | `GITHUB_ACTOR`, `RENOVATE_VERSION` |
| Any `*[bot]` / GitLab token login | `bot` | `GITHUB_ACTOR`, `GITLAB_USER_LOGIN` |
| Everyone else | `human` | — |

Detection lives in a single declarative registry
([`src/actor-detectors/index.ts`](src/actor-detectors/index.ts)): supporting a
new AI agent or bot is a one-entry addition, and PRs adding markers are
welcome. The registry and helpers (`detectActor`, `detectTrigger`,
`ACTOR_DETECTORS`) are exported if you want to reuse them in `getTags`.

When auto-detection cannot know better, specify the markers manually — they
always win over detection:

```bash
VITEST_SENTRY_TRIGGER=cron \
VITEST_SENTRY_ACTOR_TYPE=bot \
VITEST_SENTRY_ACTOR_NAME=nightly-canary \
vitest run
```

The same three tags can also be pinned from the reporter options (`tags` or
`getTags`); manually specified values take precedence over the detected ones.

### Code ownership tags (CODEOWNERS)

Route failures to the team that owns the failing file. When enabled, the
reporter matches each failing test file against your repository's `CODEOWNERS`
and attaches:

- **`code_owners`**: every matching owner, comma-joined (e.g. `@acme/api,@alice`).
- **`code_owner`**: the primary (first) owner, handy for single-owner alerts.

The full owner list is also attached as a `code_owners` extra. The feature is
**off by default**; enable it with the `codeowners` option:

```ts
new VitestSentryReporter({
  // Auto-detect the repository root (CI checkout path, else process.cwd()):
  codeowners: true,

  // Or override the root used to locate CODEOWNERS and relativize test paths:
  // codeowners: { root: '/path/to/repo' },
});
```

The `CODEOWNERS` file is looked up at the standard locations — repository root,
`.github/`, then `docs/` — and matched with gitignore-style precedence (last
matching rule wins). In CI the repository root is taken from the detected
provider's checkout path (`GITHUB_WORKSPACE`, `CI_PROJECT_DIR`,
`BUILDKITE_BUILD_CHECKOUT_PATH`, Jenkins `WORKSPACE`, CircleCI working
directory), falling back to `process.cwd()`. Both tags can be overridden via
`tags`/`getTags`, which always take precedence over the resolved owners.

Parsing depends only on [`ignore`](https://www.npmjs.com/package/ignore) (the
zero-dependency gitignore matcher); see
[`docs/decisions/0008-resolve-codeowners-into-sentry-tags.md`](docs/decisions/0008-resolve-codeowners-into-sentry-tags.md)
for the rationale.

### Environment variables and CI auto-detection

- `SENTRY_DSN` (required unless `dsn` is provided)
- `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` are respected when not explicitly set.
- CI metadata auto-detected for GitHub Actions, CircleCI, Buildkite, GitLab, Jenkins.
- `VITEST_SENTRY_TRIGGER`, `VITEST_SENTRY_ACTOR_TYPE`, `VITEST_SENTRY_ACTOR_NAME` manually pin the `trigger`/`actor_type`/`actor_name` tags.

### Multi-repo usage

Use the `tags.project` field and/or `getTags` to inject a stable project identifier. You can also add a `repository` tag if you aggregate across multiple repos.

### License

MIT

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md)
to get started, and note our [Code of Conduct](CODE_OF_CONDUCT.md). For security
issues, see the [Security Policy](SECURITY.md); for help, see [Support](SUPPORT.md).

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
`docs/decisions/0006-automate-releases-with-release-please.md` for the rationale.

### One-time repository setup

The one-time configuration of this repository (npm Trusted Publishing on
npmjs.com, workflow permissions for release-please) is documented in
[docs/setup/upstream-repository-setup.md](docs/setup/upstream-repository-setup.md).

### Reusing this workflow in a fork

The CI and release workflows are fork-safe and reusable without editing any
workflow file: forks get working CI out of the box, and can publish to their
own npm account or a private Azure Artifacts feed by injecting a secret and a
few variables. See
[docs/setup/reusing-in-a-fork.md](docs/setup/reusing-in-a-fork.md) for the
configuration reference, and
[docs/setup/publishing-to-azure-artifacts.md](docs/setup/publishing-to-azure-artifacts.md)
for the step-by-step Azure Artifacts walkthrough.


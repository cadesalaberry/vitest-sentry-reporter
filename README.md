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

Add the reporter to your `vitest.config.ts`. The reporter reads `SENTRY_DSN`
from the environment, so the minimal setup needs no options.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import VitestSentryReporter from 'vitest-sentry-reporter';

export default defineConfig({
  test: {
    reporters: ['default', new VitestSentryReporter()],
  },
});
```

Compatible with Vitest 3 and 4.

### All options

Every option is optional. The example below shows all of them, each with its
default value. Copy only the lines that you need. The sections below cover the
larger options in detail.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import VitestSentryReporter from 'vitest-sentry-reporter';

export default defineConfig({
  test: {
    reporters: [
      'default',
      new VitestSentryReporter({
        // --- Connection and event metadata ---

        // Sentry DSN. Default: process.env.SENTRY_DSN.
        // Without a DSN the reporter turns itself off and warns once.
        dsn: process.env.SENTRY_DSN,

        // Force the reporter on or off.
        // Default: on when a DSN is available.
        enabled: true,

        // Event environment. Default: SENTRY_ENVIRONMENT, else 'ci' in CI,
        // else NODE_ENV, else 'local'.
        environment: process.env.SENTRY_ENVIRONMENT || 'ci',

        // Release identifier, also sent as the Sentry `dist`.
        // Default: SENTRY_RELEASE, else the commit SHA of the detected CI.
        release: process.env.SENTRY_RELEASE,

        // Any Sentry Node SDK option, merged into the Sentry.init() call.
        // Default: {}. These values win over the ones above.
        sentryOptions: {
          debug: false,
          serverName: 'local-dev',
          sampleRate: 1,
        },

        // --- Tags, grouping and users ---

        // Static tags attached to every failure. Values become strings.
        // Default: {}.
        tags: {
          project: 'my-repo', // useful when used across multiple repos
          team: 'qa',
        },

        // Dynamic tags per failure, merged after the static `tags`.
        // Default: none.
        getTags: (ctx) => ({
          spec: ctx.relativeFilePath,
          retry: String(ctx.retry ?? 0),
        }),

        // Report only the failures that match. Default: report every failure.
        shouldReport: (ctx) => !ctx.flaky,

        // Sentry grouping key. The value below is also the default.
        // `relativeFilePath` is the repo-root-relative path, so a failure
        // groups the same way whether it ran locally or in CI.
        getFingerprint: (ctx) => [
          'vitest-failure',
          ctx.relativeFilePath ?? ctx.filePath ?? 'unknown-file',
          ctx.testName,
        ],

        // Sentry user for each failure, picked from the detected developer,
        // so Sentry counts and ranks failures per developer. The function
        // below is the default: the pseudonym of the developer who ran the
        // tests, no name and no email. The second argument is the failure
        // context. Set `false` to send no user.
        identify: ({ developer }) => developer && { id: developer.id },

        // Attach `code_owners` and `code_owner` tags from CODEOWNERS.
        // Default: false. `true` is the same as { enabled: true }.
        codeowners: {
          enabled: true,
          root: process.cwd(), // default: the CI checkout path, else cwd
        },

        // --- Final event shaping ---

        // Last hook before the event leaves. Return null to drop the event.
        // Default: none.
        beforeSend: (event, _hint, ctx) => {
          event.level = 'error';
          event.tags = { ...(event.tags || {}), quicklook: 'true' };
          event.extra = {
            ...(event.extra || {}),
            suite_path: ctx.suitePath,
            duration_ms: ctx.durationMs,
          };
          return event;
        },

        // --- Volume and safety ---

        // Maximum number of events for one Vitest run. Default: no limit.
        maxEventsPerRun: 200,

        // Print the events instead of sending them. Default: false.
        // It has no effect when `enabled` is false.
        dryRun: false,

        // --- Declared, but not attached to events yet ---

        // For the hostname, use sentryOptions.serverName instead.
        serverName: 'local-dev',
        // To group events across repositories, use tags.project instead.
        project: 'my-repo',
      }),
    ],
  },
});
```

The `ctx` passed to `shouldReport`, `getTags`, `getFingerprint` and
`beforeSend`, and the second argument of `identify`, is the failure context. It carries `testName`, `fullTitle`,
`suitePath`, `filePath`, `relativeFilePath`, `message`, `stack`, `error`,
`durationMs`, `retry`, `flaky`, `logs` and `meta`.

### What gets reported

- **Error**: The thrown error from the failed test (or synthesized from message).
- **Tags**: `test_file` (repo-relative path, see below), `test_name`, `test_full_title`, `test_project` (Vitest project/workspace name, handy for monorepos), `flaky`, `retry`, `node_version`, `os_platform`, `os_release`, `ci`, `trigger`, `actor_type`, `actor_name`, `job_name` (CI job/step/shard name), `repository`, `branch`, `commit_sha`, `run_url` (link to the CI run/build, when detected), plus `code_owners`/`code_owner` when CODEOWNERS resolution is enabled, plus `triggered_by` when `identify` returns a user, plus any custom tags.
- **User**: the user that `identify` picks, which powers Sentry's "users affected" metric. By default, the pseudonym of the developer who ran the tests (see below).
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

### Who triggered the run (identity / "users affected")

`actor_type`/`actor_name` tell you _what kind_ of actor ran the tests. For a
human they stop at `human` and drop the login. The `identify` option attributes
each failure to the developer who ran the tests. It sets Sentry's **user**,
which drives the built-in "N users affected" metric. Sentry then ranks each
failed test by the number of developers that it blocks. A searchable
`triggered_by` tag carries the username, else the id.

**Identity is on by default.** The default sends no name and no email. It sends
one pseudonymous id for the developer, for example `dev-e383094d4770a80f`. That
id is still personal data under the GDPR (see [The pseudonym](#the-pseudonym)).

`identify` is a function. The reporter detects the developer once per run, on
the first failure. Then it calls the function for each failure, with the
detection and the failure context, and it sends the user that the function
returns:

```ts
new VitestSentryReporter({
  // The default: the pseudonym of the developer, and nothing else.
  identify: ({ developer }) => developer && { id: developer.id },
});
```

`developer` is the person who ran the tests:

| Where the tests run | `developer`                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| In CI               | The person who triggered the CI run.                                   |
| Outside CI          | The git user (`git config user.email`, `user.name`), else the OS user. |

It has an `id`, plus the `username` and the `email` when the source knows them.
The `id` is always a pseudonym, never a raw account id. The `username` and the
`email` reach Sentry only when your function returns them.

| To send                               | `identify`                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The pseudonym only (default)          | `({ developer }) => developer && { id: developer.id }`                                         |
| The pseudonym and the name            | `({ developer: d }) => d && { id: d.id, username: d.username }`                                |
| All that the reporter knows           | `({ developer }) => developer`                                                                 |
| No user for one Vitest project        | `({ developer: d }, ctx) => ctx.meta?.projectName === 'e2e' ? undefined : d && { id: d.id }`   |
| No user and no tag, with no detection | `false`                                                                                        |

Return `undefined` to send no user. If the function throws, or returns a value
that is not a Sentry user, the reporter sends the failure without a user and
logs one warning. Automation bots and AI agents (the same ones detected for
`actor_type`) are excluded, so `developer` is absent for them.

#### How the developer is detected

- **In CI**: the person who triggered the run, per provider (GitHub `GITHUB_TRIGGERING_ACTOR`/`GITHUB_ACTOR`, GitLab `GITLAB_USER_*`, CircleCI `CIRCLE_USERNAME`, Buildkite `BUILDKITE_BUILD_CREATOR*`, Jenkins `CHANGE_AUTHOR*`/`BUILD_USER*`). No git command runs. A CI that exposes no trigger-er, for example a bare `CI=true`, gives no developer, because the git user and the OS user of a CI machine are not a developer.
- **Outside CI**: `git config user.email` and `user.name`, else the OS username. The reporter does not read the commit history, so the result does not depend on the checkout depth or on who wrote the last commit.

On a re-run, the trigger-er is the person who started the re-run. A manual
`triggered_by` in `tags`/`getTags` overrides the detected one. The
`detectIdentities` helper is exported for reuse.

#### The pseudonym

Every `id` has four properties:

- **Stable**: one git identity or one CI account always gets the same id, so the count stays correct across runs.
- **Opaque**: the id is the first 16 characters of a SHA-256 digest, with a `dev-` prefix.
- **Seeded** by the email, else the username, else the CI account id. The seed is trimmed and lowercased first.
- **Reproducible**: anybody who knows the seed can compute the same digest offline. The list of team emails maps back an id seeded by an email. The list of logins maps back an id seeded by a login, for example on GitHub Actions.

The id counts git identities and CI accounts, not people. On GitHub Actions the
trigger-er has no email, so the CI id of a developer is seeded by the login,
and it differs from the local id of the same developer. A developer with two
email addresses also gets two ids. To count each context on its own, filter the
Sentry issue by environment: the default environment is `ci` in CI, and
`NODE_ENV` (else `local`) outside CI.

The id is pseudonymous and not anonymous. The digest is not salted, so a party
who already holds the list of team emails or logins can match an id to a
person. Treat the id as personal data under the GDPR, and keep it out of public
dashboards. Before you upgrade from 1.x, check the change with your privacy
team: 1.x sent no user by default, and 2.x sends this id by default.

See
[docs/decisions/0014-identify-callback-pseudonymous-by-default.md](docs/decisions/0014-identify-callback-pseudonymous-by-default.md)
for the rationale and the rejected alternatives.

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
- The `identify` option reads the CI trigger-er variables listed above (GitHub/GitLab/CircleCI/Buildkite/Jenkins) in CI, and `git config` and the OS user outside CI.

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
few variables. release-please runs only on the upstream repository — a fork
publishes by rebasing its `main` onto upstream and force-pushing, which ships
the current version to the fork's registry if it isn't there yet. See
[docs/setup/reusing-in-a-fork.md](docs/setup/reusing-in-a-fork.md) for the
configuration reference, and
[docs/setup/publishing-to-azure-artifacts.md](docs/setup/publishing-to-azure-artifacts.md)
for the step-by-step Azure Artifacts walkthrough.


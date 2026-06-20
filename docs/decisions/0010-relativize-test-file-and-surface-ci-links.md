---
title: Relativize test_file for grouping and surface CI links and project name
status: accepted
date: 2026-06-18
authors:
  - cadesalaberry
---

## Context

- Triage is a core value proposition of this reporter. Three gaps reduced its
  usefulness, especially in monorepos and across local/CI runs:
  1. **Grouping splits by checkout path.** The default fingerprint (and the
     `test_file` tag) used the absolute module path Vitest reports. That path
     differs between a developer's machine (`/Users/you/repo/src/x.test.ts`) and
     CI (`/home/runner/work/repo/repo/src/x.test.ts`), so the *same* failure
     produced *different* Sentry issues depending on where it ran.
  2. **No project/workspace dimension.** The Vitest project name was already
     collected into `ctx.meta.projectName` but never surfaced, leaving monorepo
     users unable to slice failures by package.
  3. **No deep links for triage.** The CI provider layer already knew the run
     URL but exposed nothing about the pull/merge request, the job/shard, or a
     direct link to the commit under test — all high-value jump-off points when
     investigating a failure.

## Decision

- **Relativize the test file path.** `toFailureContext` now computes
  `relativeFilePath`: the module path made relative to the repository root
  (reusing the existing `repoRoot()` helper — CI checkout path, else
  `process.cwd()`) and normalized to POSIX separators. The `test_file` tag and
  the default fingerprint use it, falling back to the absolute path when the
  file lies outside the root or no root is known. The absolute path is retained
  on `ctx.filePath` and the `test` context for debugging. A user-supplied
  `getFingerprint` still wins.
- **Add a `test_project` tag** sourced from `ctx.meta.projectName`. Empty
  project names (Vitest's default root project) are omitted.
- **Extend the `CIProvider` interface** with `pullRequestUrl`, `jobName`, and
  `commitUrl`, implemented per provider from documented environment variables
  (e.g. GitHub `GITHUB_REF`/`GITHUB_JOB`/`GITHUB_SHA`, GitLab
  `CI_MERGE_REQUEST_IID`/`CI_JOB_NAME`/`CI_PROJECT_URL`/`CI_COMMIT_SHA`, CircleCI
  `CIRCLE_PULL_REQUEST`/`CIRCLE_JOB`, Buildkite `BUILDKITE_LABEL`, Jenkins
  `CHANGE_URL`/`JOB_NAME`). Where a provider has no portable variable for a
  link, the method returns `undefined` rather than guessing.
- **Surface the links.** `job_name` (low cardinality, a good filter) becomes a
  tag; the URLs go into a dedicated `ci` context (`pull_request_url`, `run_url`,
  `commit_url`, `workflow_id`), only attached when at least one is present.

## Consequences

- **Grouping changes (the one breaking behavior).** Existing issues whose
  fingerprints encoded an absolute path will re-group once under the new
  repo-relative path; thereafter local and CI failures for the same test
  collapse into a single issue. Users who relied on the old grouping can pin it
  with `getFingerprint`. Shipped as a `feat` (minor bump) with this note.
- Monorepo failures are sliceable by `test_project`, and triagers get one-click
  links to the PR/MR, the run, and the commit without leaving the Sentry issue.
- The provider layer gains three small, well-tested methods reused by any future
  link-oriented feature; URL construction is confined to the provider that owns
  the relevant environment variables.
- New tag/context cardinality is modest: `test_project` and `job_name` are
  low-cardinality; the URLs live in context (not indexed tags).

## Alternatives

- **Gate relativization behind an option**: rejected — cross-checkout grouping
  is the correct default and the escape hatch (`getFingerprint`) already exists;
  an extra flag would leave most users with the worse default.
- **Relativize only the fingerprint, leave the `test_file` tag absolute**:
  rejected — the tag is used to search and group in the Sentry UI too, so a
  consistent value there is as valuable; the raw path remains on the `test`
  context for anyone who needs it.
- **Expose the URLs as tags**: rejected — PR/commit URLs are high-cardinality
  and not useful as indexed facets; a `ci` context keeps them visible for triage
  without polluting the tag space. The filterable `job_name` stays a tag.

## Tests

- `src/utils.test.ts` covers `relativeTestFile` (relativization, out-of-root and
  missing-input pass-through), `jobName`, `ciContext` (defined-only links, empty
  outside CI), and the new `baseTags` fields (`test_project`, `job_name`,
  relative `test_file`, empty-project omission).
- Per-provider tests assert the new `pullRequestUrl`/`jobName`/`commitUrl` and
  the extended `envSnapshot` keys.
- Reporter tests assert the `test_project` tag and that the `ci` context is
  attached in CI and skipped locally.

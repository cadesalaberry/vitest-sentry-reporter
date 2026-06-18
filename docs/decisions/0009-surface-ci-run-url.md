---
title: Surface the CI run URL on reported failures
status: accepted
date: 2026-06-18
authors:
  - cadesalaberry
---

## Context

- Every CI provider already computes a `runUrl` (e.g. `CIRCLE_BUILD_URL` for
  CircleCI, the constructed Actions run URL for GitHub) and the
  `CIProvider.runUrl` method is unit-tested per provider.
- However, that value was never consumed: `baseTags`/`extras` surfaced
  `repository`, `branch`, `commit_sha`, and a minimal env snapshot, but not the
  run URL. The build link only ever appeared — when it appeared at all — buried
  inside the provider env snapshot extra (`CIRCLE_BUILD_URL`), which is neither
  prominent nor clickable.
- The practical effect: a Sentry issue for a failed test had no way to get back
  to the failing CI run. Triaging a failure meant manually hunting down the
  matching build, defeating much of the reporter's "actionable context" value.

## Decision

- Add `runUrl()` and `workflowId()` helpers in `src/utils.ts`, mirroring the
  existing `repository()`/`branch()`/`commitSha()` provider accessors.
- Add a `run_url` tag to `baseTags()` so the run link is visible in the Tags
  panel and searchable, consistent with the other CI-derived tags. Like
  `repository`/`branch`/`commit_sha`, it is dropped when no provider is
  detected and is not user-overridable.
- Add a dedicated, structured `ci` context (`provider`, `run_url`,
  `workflow_id`) set via `scope.setContext('ci', …)`. Sentry auto-linkifies
  URL values in the contexts panel, so `run_url` renders as a **clickable link**
  straight to the failing build. The context is only attached when a CI
  provider is detected (empty record ⇒ skipped).

## Consequences

- Sentry issues now link back to the failing CI run (e.g. the CircleCI build)
  with one click, across every supported provider that exposes a run URL.
- Previously dead `runUrl`/`workflowId` provider methods are now exercised
  end-to-end.
- Behavior is unchanged outside CI: with no provider, no `run_url` tag and no
  `ci` context are emitted.

## Alternatives

- **Rely on the existing env snapshot extra**: rejected — the URL is buried,
  not guaranteed present, and not rendered as a link.
- **Tag only, no context**: rejected — Sentry tag values are not rendered as
  external hyperlinks, so the link would not be clickable.
- **Context only, no tag**: rejected — the tag keeps the URL visible and
  searchable alongside the other CI metadata.

## Tests

- `src/utils.test.ts` covers `runUrl`/`workflowId` (provider present and
  absent), the new `run_url` field in `baseTags`, and `ciContext`
  (populated and empty).
- `src/reporter.test.ts` asserts the `ci` context and `run_url` tag are emitted
  for an active provider, and omitted when none is detected.

---
title: Require published package identity as configuration, not a commit
status: accepted
date: 2026-08-14
authors:
  - cadesalaberry
---

## Context

ADR-0012 made a fork publish by rebasing onto upstream and pushing — no
fork-local release PR, no version-bump commit. But the setup guides still
told a fork to commit one change before its first publish:
[Publishing to Azure Artifacts, Step 5](../setup/publishing-to-azure-artifacts.md)
had the fork owner rename `name` (and optionally `repository`/`homepage`) in
`package.json`, through a PR, to avoid publishing under the upstream
package's name.

That commit fights the rebase model it sits next to:

- It is fork-local history that every future `git rebase upstream/main` must
  carry forward. It replays cleanly only as long as upstream never touches
  the same `package.json` fields; the day it does, the fork owner resolves a
  conflict on every subsequent sync.
- It source-controls values — where this fork publishes to, under what name
  — that are deployment configuration, no different in kind from
  `NPM_REGISTRY_URL` or `NPM_PUBLISH_ACCESS`, which already live in
  repository variables rather than in `package.json`.

A first draft of this decision defaulted the name to the repository (scoped
to the owner, except upstream's own owner). Review preferred not to encode
that owner-based exception into the workflow at all: a fork that gets far
enough to set the `NPM_TOKEN` secret can set one more variable, so requiring
the name explicitly costs little and needs no special case for upstream.

## Decision

- `NPM_PACKAGE_NAME` is a **required** repository variable for any
  repository that publishes — upstream included. The `publish` job reads it
  and writes it with `npm pkg set name="$pkg_name"`, in the job's checkout
  only, before either publish path runs. If it is unset once a publish is
  actually attempted, the job fails with a clear message instead of
  guessing a name.
- `repository.url`, `homepage`, and `bugs.url` have no such choice to make —
  they unambiguously point at wherever `GITHUB_REPOSITORY` says the code is
  — so they are always derived from it and set the same way, needing no
  variable at all.

`npm pkg set` only ever touches the runner's working copy — it is never
committed or pushed — so `package.json` in git stays identical on upstream
and every fork. A rebase has nothing to replay and nothing to conflict on for
any of these fields.

## Consequences

- Every repository that publishes, including upstream, must set
  `NPM_PACKAGE_NAME` (upstream's is `vitest-sentry-reporter`, the name it
  already publishes under). A push that would publish and has `NPM_TOKEN`
  (or is upstream) but no `NPM_PACKAGE_NAME` now fails the run, rather than
  publishing under a guessed name — a deliberate trade of one more required
  variable for zero naming special-cases in the workflow.
- A fork's first publish needs `NPM_TOKEN` and `NPM_PACKAGE_NAME` (plus
  `NPM_REGISTRY_URL` for a private registry) and no commit, no PR, ever —
  for the name, the repository URL, the homepage, or the issues URL.
- `package.json`'s committed `name`/`repository`/`homepage`/`bugs` fields
  become a local-dev fallback only; none of them is what actually gets
  published once this job runs.
- A fork that has configured nothing still gets a clean, error-free skip
  (unchanged from ADR-0011/0012): the `NPM_PACKAGE_NAME` requirement only
  applies once `NPM_TOKEN` is present (or the repository is upstream), i.e.
  once a publish would actually be attempted.

## Alternatives

- **Default to the repository name, scoped by owner (`@owner/repo`), with an
  exception for the upstream owner**: rejected on review — the exception is
  workflow logic that exists only to work around one hardcoded case, and
  every fork sets a publish token anyway, so requiring the name explicitly
  removes the special case for a small, one-time configuration cost.
- **Keep the renamed-`package.json` commit, teach the rebase to skip it**:
  rejected — still fork-local history to carry forever, and still conflicts
  the moment upstream edits the same fields.
- **Read the name from a fork-specific file (e.g. `.forkrc`) instead of a
  repository variable**: rejected — a new file is still something to commit
  and keep in sync across rebases; a repository variable needs neither.

## References

- Amends the setup guidance from
  [ADR-0011](0011-make-release-workflow-fork-reusable.md) and
  [ADR-0012](0012-fork-publishing-by-rebase.md): those introduced the
  configuration-by-variable model this decision extends to package identity.
- How-to: [Reusing the workflows in a fork](../setup/reusing-in-a-fork.md)
- How-to: [Publishing a fork to a private Azure Artifacts feed](../setup/publishing-to-azure-artifacts.md)
- `npm pkg set`: https://docs.npmjs.com/cli/v10/commands/npm-pkg
- GitHub Actions — default environment variables (`GITHUB_REPOSITORY`):
  https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables

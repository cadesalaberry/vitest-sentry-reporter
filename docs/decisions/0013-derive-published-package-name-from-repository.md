---
title: Derive the published package name from the repository, not a commit
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
- It source-controls a value — where this fork publishes to, under what name
  — that is deployment configuration, no different in kind from
  `NPM_REGISTRY_URL` or `NPM_PUBLISH_ACCESS`, which already live in
  repository variables rather than in `package.json`.

## Decision

The `publish` job resolves the package name at publish time and writes it
with `npm pkg set name="$pkg_name"`, in the job's checkout only, before
either publish path runs:

- Default: the repository name, `${GITHUB_REPOSITORY##*/}` (the part after
  the owner). For the upstream repository this already equals the
  `vitest-sentry-reporter` name it has always published under, so upstream's
  behavior does not change.
- Override: the `NPM_PACKAGE_NAME` repository variable, for a fork that wants
  a scoped name (e.g. `@your-org/vitest-sentry-reporter`) to avoid clashing
  with the upstream package on a registry that mixes both.

`npm pkg set` only ever touches the runner's working copy — it is never
committed or pushed — so `package.json` in git stays identical on upstream
and every fork. A rebase has nothing to replay and nothing to conflict on for
the package name.

## Consequences

- A fork's first publish needs at most two repository variables
  (`NPM_REGISTRY_URL`, `NPM_PACKAGE_NAME`) and no commit, no PR, and no
  rebase conflict risk tied to naming.
- `package.json`'s committed `name` field is effectively a local-dev label; it
  is never what actually gets published once this job runs. Contributors
  reading `package.json` locally still see a real, buildable package name.
- Upstream is unaffected: `GITHUB_REPOSITORY` resolves to the name it already
  publishes under.
- Adjusted alongside, in the same job: the "Upgrade npm for trusted
  publishing" step ran `npm install -g npm@latest` unconditionally, on every
  fork push, purely to satisfy the OIDC path's `>=11.5.1` requirement (a
  fork's token-based publish never needed it). #49 separately fixed that
  step's `EBADENGINE` failure by bumping this job's Node to `>=22.22.2`, which
  npm's latest major requires. This change goes one step further and scopes
  the upgrade to the upstream OIDC path, so a fork's publish no longer runs
  it at all.

## Alternatives

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
  configuration-by-variable model this decision extends to the package name.
- How-to: [Reusing the workflows in a fork](../setup/reusing-in-a-fork.md)
- How-to: [Publishing a fork to a private Azure Artifacts feed](../setup/publishing-to-azure-artifacts.md)
- `npm pkg set`: https://docs.npmjs.com/cli/v10/commands/npm-pkg
- GitHub Actions — default environment variables (`GITHUB_REPOSITORY`):
  https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables

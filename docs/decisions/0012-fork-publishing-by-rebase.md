---
title: Run release-please only upstream and publish forks by rebase
status: accepted
date: 2026-07-24
authors:
  - cadesalaberry
---

## Context

ADR-0011 made the release workflow usable by forks. A fork configures
publication with one secret and some variables. It can publish to its own npm
account or to a private Azure Artifacts feed. But the release-please job
continued to run on each fork's `main`.

This does not operate correctly on a fork that tracks upstream:

- A new fork has none of the upstream `vX.Y.Z` tags. Without tags,
  release-please cannot find the last release and calculates an incorrect
  next version. Observed: a fork with `main` at version 1.4.1 got a release
  PR for "release 1.0.3".
- A tracking fork must not set its own versions. Its function is to publish
  the upstream versions to a different registry. Versions, changelogs, and
  tags are upstream data. A fork-local release PR is unwanted, and a merge of
  one splits the version history. Each subsequent sync then has rebase
  conflicts on `package.json` and `CHANGELOG.md`.
- The publish job ran only when release-please made a release. A fork that
  correctly does not merge fork-local release PRs could not publish.

The sync procedure we want for forks is "rebase to publish": get the upstream
`main` (it contains the version and the changelog), rebase the fork's delta
on it, and push. The workflow then publishes that version to the fork's
registry, unless the registry already has it.

## Decision

- **The `release-please` job runs only on the upstream repository**
  (`if: github.repository == 'cadesalaberry/vitest-sentry-reporter'`).
  release-please does not run on forks. Forks do not need its setup: no
  "allow Actions to create PRs" setting and no tags.
- **The `publish` job runs on forks on each push to `main`** and on manual
  `workflow_dispatch` (a new trigger). The job condition is `!cancelled() &&
  (release_created == 'true' || repository != upstream)`. Upstream publishes
  one time for each release; the OIDC path is unchanged. On forks, the
  skipped release-please job has empty outputs and does not block the publish
  job. A failed upstream release-please blocks the publish job, because
  `release_created` stays empty.
- **The token-path publication is idempotent.** Before it publishes, the job
  reads `name` and `version` from `package.json` and examines the target
  registry. The check uses the `.npmrc` that the job wrote before, because
  Azure Artifacts requires authentication for reads. If the registry has that
  exact version, the job stops without an error. The job also accepts a
  recognized duplicate-version rejection as a success. A push between
  upstream releases completes without an error and has no effect.
- **Fork sync procedure**: `git fetch upstream && git rebase upstream/main &&
  git push --force-with-lease origin main`. The setup guides show this
  procedure.

## Consequences

- The release procedure of a tracking fork is one rebase and one push.
  Versions, tags, and the changelog stay upstream data and cause no
  conflicts.
- Forks do not make incorrect release PRs. Forks do not need the "Allow
  GitHub Actions to create and approve pull requests" setting.
- The publish job runs checkout, install, and build on each fork push to
  `main`, also on forks with no configuration. Then the no-token check stops
  it. This is accepted: a job-level `if` cannot read secrets, and the build
  is a test of the fork's `main`.
- Fork-local commits stay unpublished until a rebase changes the version. A
  fork that wants its own versions is not supported: it must change the
  workflow.
- The upstream flow is identical, with npm Trusted Publishing (OIDC) and
  provenance. The workflow file name did not change, so the npm Trusted
  Publisher connection (repository + workflow file) is not changed.

## Alternatives

- **Keep release-please on forks, with fork-local manifests and tags**:
  rejected. Each fork needs a bootstrap (tags, manifest, configuration), the
  version data exists two times, and version-bump commits cause rebase
  conflicts.
- **Publish forks from tags**: rejected. A tracking fork has no tags (a
  branch push does not move tags), and fork tags add the bookkeeping that
  this ADR removes.
- **A separate workflow file for fork publication**: rejected in ADR-0011.
  It copies the build steps, and forks must edit files.

## References

- Amends [ADR-0011](0011-make-release-workflow-fork-reusable.md). The
  registry and authentication mechanism for forks is unchanged. This ADR
  changes when forks publish, and stops release-please on forks.
- [ADR-0006](0006-automate-releases-with-release-please.md): release-please
  automation (upstream).
- How-to: [Reusing the workflows in a fork](../setup/reusing-in-a-fork.md)
- How-to: [Publishing a fork to a private Azure Artifacts feed](../setup/publishing-to-azure-artifacts.md)
- GitHub Actions — expressions and job status checks (`!cancelled()`, skipped
  `needs`, outputs of skipped jobs):
  https://docs.github.com/en/actions/reference/workflows-and-actions/expressions

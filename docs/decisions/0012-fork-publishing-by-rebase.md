---
title: Run release-please only upstream and publish forks by rebase
status: accepted
date: 2026-07-24
authors:
  - cadesalaberry
---

## Context

ADR-0011 made the release workflow reusable by forks: publishing is configured
entirely through secrets/variables, and a fork can target its own npm account
or a private Azure Artifacts feed. But the *versioning* half of the workflow —
the release-please job — still ran on every fork's `main`.

That is broken by construction for a fork that only tracks upstream:

- A fresh fork has none of upstream's `vX.Y.Z` tags, so release-please cannot
  find the last release and miscomputes the next version from whatever history
  heuristics it lands on. Observed in practice: a fork whose `main` was at
  `1.4.1` got a release PR proposing "release 1.0.3".
- A tracking fork does not *want* its own versioning. Its job is to republish
  upstream's versions to its own registry; version numbers, changelogs, and
  tags are upstream concerns. Fork-local release PRs are pure noise, and
  merging one would fork the version history (rebase conflicts on
  `package.json`/`CHANGELOG.md` every sync thereafter).
- The publish job only ran when release-please created a release, so a fork
  that (correctly) never merges fork-local release PRs could never publish.

The sync model we actually want for forks is **rebase to publish**: pull
upstream's `main` (which already contains the release-please version bumps and
changelog), rebase the fork's small delta on top, force-push — and the
workflow publishes that version to the fork's registry if it isn't there yet.

## Decision

- **Gate the `release-please` job to the upstream repository**
  (`if: github.repository == 'cadesalaberry/vitest-sentry-reporter'`).
  Forks never run release-please and need none of its setup (no
  "allow Actions to create PRs" toggle, no tags).
- **Run the `publish` job on forks on every push to `main`** (and on manual
  `workflow_dispatch`, added as a re-publish lever). The job's condition
  becomes `!cancelled() && (release_created == 'true' || repository !=
  upstream)`: upstream keeps publishing exactly once per release (OIDC path
  unchanged), while on forks the skipped release-please job — whose outputs
  evaluate to empty strings — no longer blocks publishing. A *failed* upstream
  release-please still blocks the publish job (`release_created` stays empty).
- **Make the token-path publish idempotent.** Before publishing, the job reads
  `name`/`version` from `package.json` and checks the target registry (with
  the freshly written `.npmrc` — Azure Artifacts requires auth even for
  reads). If that exact version is already published, it skips cleanly; a
  duplicate-version rejection at publish time (races, pre-check
  false-negatives) is likewise treated as success. Between upstream releases a
  fork's rebase pushes are therefore green no-ops.
- **Fork sync contract**: `git fetch upstream && git rebase upstream/main &&
  git push --force-with-lease origin main`. Documented in the setup guides.

## Consequences

- A tracking fork's entire release process is one rebase + force-push;
  versions, tags, and changelog stay upstream-owned and conflict-free.
- Forks no longer produce bogus release PRs, and the "Allow GitHub Actions to
  create and approve pull requests" setting is no longer needed on forks.
- The publish job now runs (checkout, install, build) on every fork-main push
  even for forks that configured nothing, then exits at the no-token guard.
  Accepted: secrets cannot be read in a job-level `if`, and the build doubles
  as a smoke check of the fork's `main`.
- Fork-local commits ride on top of upstream unpublished until the next
  version arrives via rebase (the current version is already on the feed, so
  pushes skip). A fork that wants independently versioned releases is out of
  scope by design — it would need to edit the workflow.
- The upstream flow, including npm Trusted Publishing (OIDC) and provenance,
  is byte-identical; the workflow file was not renamed, so the npm Trusted
  Publisher binding (repo + workflow file) is unaffected.

## Alternatives

- **Keep release-please on forks with fork-local manifests/tags**: rejected —
  requires per-fork bootstrap (tags, manifest, config), duplicates version
  bookkeeping already done upstream, and guarantees rebase conflicts on
  version-bump commits.
- **Tag-triggered publishing on forks**: rejected — tracking forks have no
  tags by contract (rebase + force-push does not transfer upstream tags), and
  minting fork tags reintroduces the bookkeeping this ADR removes.
- **A separate fork-only publish workflow file**: already rejected in
  ADR-0011 — duplicated build steps and forks editing workflow files.

## References

- Amends [ADR-0011](0011-make-release-workflow-fork-reusable.md): the
  fork-configurable *auth/registry* mechanism is unchanged; this ADR changes
  *when* forks publish and stops release-please on forks.
- [ADR-0006](0006-automate-releases-with-release-please.md): release-please
  automation (upstream).
- How-to: [Reusing the workflows in a fork](../setup/reusing-in-a-fork.md)
- How-to: [Publishing a fork to a private Azure Artifacts feed](../setup/publishing-to-azure-artifacts.md)
- GitHub Actions — expressions and job status checks (`!cancelled()`, skipped
  `needs` propagation, outputs of skipped jobs evaluating to empty):
  https://docs.github.com/en/actions/reference/workflows-and-actions/expressions

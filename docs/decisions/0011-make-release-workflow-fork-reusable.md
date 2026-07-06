---
title: Make the release workflow reusable by forks (token / Azure Artifacts publishing)
status: accepted
date: 2026-07-06
authors:
  - cadesalaberry
---

## Context

Releases are automated with release-please and publish to npm via Trusted
Publishing (OIDC) — see ADR-0006. That path is intentionally tied to the
upstream repository: the Trusted Publisher on npmjs.com is configured for
`cadesalaberry/vitest-sentry-reporter` + `release.yml`, and there is no
`NPM_TOKEN` secret.

This is great for the upstream repo but makes the workflow non-reusable for
anyone who forks it:

- A fork cannot publish. The publish job only ever runs `npm publish
  --provenance` against the public registry using OIDC, which npm rejects for a
  fork because the OIDC `repository` claim does not match the upstream Trusted
  Publisher. There is no way to supply a token or target a different registry.
- Teams that want to consume the reporter from a **private Azure Artifacts
  feed** (a common enterprise setup) had no supported path at all.
- The CI workflow hardcoded the Codecov `slug` to the upstream repo and used
  `fail_ci_if_error: true` unconditionally, so a fork's coverage upload pointed
  at the wrong project and hard-failed when the fork had no `CODECOV_TOKEN`.

We want the workflows to be safely reusable: a fork should get working CI out
of the box, be able to publish to its own npm account or a private registry by
injecting secrets/variables, and never accidentally publish (or fail) when it
has configured nothing.

## Decision

Keep the upstream OIDC path as the default and add a token-based path selected
automatically at publish time, configured entirely through GitHub Actions
secrets and variables (no workflow edits required in a fork).

- **Auth path selection** (`release.yml`, `publish` job): if the `NPM_TOKEN`
  secret is empty, use Trusted Publishing (OIDC) exactly as before
  (`npm publish --provenance --access public`). If `NPM_TOKEN` is set, write a
  project-local `.npmrc` that references the token as the registry `_authToken`
  (via `${NODE_AUTH_TOKEN}`, so the token is never written to disk in the clear)
  with `always-auth=true`, and publish to `NPM_REGISTRY_URL`.
- **Configuration surface** (repository *variables*, non-secret):
  - `NPM_REGISTRY_URL` — target registry, defaulting to
    `https://registry.npmjs.org`. A private Azure Artifacts feed is expressed as
    `https://pkgs.dev.azure.com/ORG/PROJECT/_packaging/FEED/npm/registry/`.
  - `NPM_PUBLISH_ACCESS` — `public` (default) or `restricted` for a private feed.
  - `NPM_PROVENANCE` — opt in to provenance on token-based npmjs.org publishes;
    ignored for other registries because provenance is npm-only.
- **Fork safety**: a fork that has *not* injected `NPM_TOKEN` and is not the
  upstream repo skips the publish step with a helpful message and exits `0`,
  rather than attempting an OIDC publish that can only fail. The upstream repo
  is the sole hardcoded reference and only gates the tokenless OIDC convenience;
  forks are fully served by the token path.
- **Codecov** (`ci.yml`): derive the `slug` from `github.repository` so a fork
  uploads to its own project, and set `fail_ci_if_error` to
  `${{ secrets.CODECOV_TOKEN != '' }}` so only a repo that actually configured a
  token hard-fails on upload errors; a token-less fork gets a best-effort
  tokenless upload that never fails CI. The upstream repo has the token, so its
  behavior is unchanged.

## Consequences

- Forks get working CI with no edits, and can publish to their own npm account
  or a private Azure Artifacts feed by setting one secret (and, for a private
  feed, a couple of variables).
- The upstream release path is unchanged: with no `NPM_TOKEN`, publishing is
  still OIDC Trusted Publishing with provenance to the public registry.
- There is no accidental-publish risk. A fork cannot hijack the upstream package
  (npm rejects a mismatched OIDC claim and an unauthorized token), and a fork
  that configures nothing skips publishing instead of failing.
- Provenance is only available on the npmjs.org paths; Azure Artifacts publishes
  omit it, which is expected since npm provenance is registry-specific.
- The publish job's id changed from `publish-npm` to `publish` to reflect that
  it is no longer npm-only. The npm Trusted Publisher config keys off the repo +
  workflow *file* name, not the job id, so this does not affect upstream
  publishing.

## Alternatives

- **A separate `publish-azure.yml` workflow**: rejected — it would duplicate the
  build/install steps and the release-please gating, and forks would still have
  to edit files. A single job selecting the auth path by secret presence keeps
  one source of truth.
- **Base64 `_password`/`username`/`email` `.npmrc` for Azure**: rejected in
  favor of the simpler `_authToken` form, which Azure Artifacts accepts for a
  PAT and which also works unchanged for npm automation tokens, so one code path
  covers both registries.
- **Gate publishing on a dedicated `PUBLISH_ENABLED` variable**: rejected —
  presence of `NPM_TOKEN` (or being the upstream repo) already expresses intent,
  so an extra flag would be redundant configuration.

## References

- ADR-0006: Automate releases with release-please and Conventional Commits
- npm trusted publishing (OIDC): https://docs.npmjs.com/trusted-publishers
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- Use Azure Artifacts as a private npm registry:
  https://learn.microsoft.com/azure/devops/artifacts/npm/npmrc
- GitHub Actions — variables and secrets:
  https://docs.github.com/actions/learn-github-actions/variables

# Reusing the workflows in a fork

The CI and release workflows are safe for forks: no upstream value can leak
or cause an unwanted operation. Codecov uploads use the fork's repository
name and do not fail CI on a fork that has no `CODECOV_TOKEN`. Versions come
only from upstream: the release-please job runs only on the upstream
repository, not on forks. A fork publishes when you push to its `main`: the
publish job sends the version in `package.json` to the registry that you
configure. The job stops without an error when you set no publication secret,
or when the registry already has that version. You do not edit workflow
files. For the design decisions, see
[ADR-0011](../decisions/0011-make-release-workflow-fork-reusable.md) and
[ADR-0012](../decisions/0012-fork-publishing-by-rebase.md).

## Configuration reference

To publish from your fork, add the values below in **Settings → Secrets and
variables → Actions**. When the `NPM_TOKEN` secret is present, the release
job uses token authentication and selects the correct `.npmrc` format for
the registry host.

| Kind | Name | Purpose |
|---|---|---|
| Secret | `NPM_TOKEN` | An npm automation token, **or** — for Azure Artifacts — a Personal Access Token with the *Packaging: Read & write* scope. Give the **raw** PAT; the workflow encodes it in base64 as Azure requires. |
| Variable | `NPM_REGISTRY_URL` | The target registry. Default: `https://registry.npmjs.org`. |
| Variable | `NPM_PUBLISH_ACCESS` | `public` (default) or `restricted`. Use `restricted` for a private feed. |
| Variable | `NPM_AUTH_STYLE` | `password` (Azure base64-PAT format) or `token` (bearer `_authToken`). The registry host sets the default; set the variable only for a self-hosted Azure DevOps Server URL. |
| Variable | `NPM_PROVENANCE` | `true` attaches [provenance](https://docs.npmjs.com/generating-provenance-statements) on token-based publications to npmjs.org. Other registries ignore the variable (provenance is npm-only). |

## Sync and publish (rebase to publish)

Forks do not run release-please and do not need tags: versions, changelogs,
and releases are upstream data. To get new upstream releases, rebase your
fork's `main` on upstream and push:

```bash
git remote add upstream https://github.com/cadesalaberry/vitest-sentry-reporter.git   # one time
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin main
```

The push starts the release workflow. release-please does not run, because
the repository is not upstream. The publish job publishes the version in
`package.json`, unless the registry already has it — a push between upstream
releases completes without an error and has no effect. Fork-only commits stay
on top of upstream; the workflow publishes them when a rebase changes the
version. To start a publication manually (for example, after you replace a
token), use **Actions → Release → Run workflow** (`workflow_dispatch`) and
keep the branch selection on `main` — publication must run from your fork's
`main`, so that it sends the rebased version.

## Publish to your own npm account

Set the `NPM_TOKEN` secret to an npm automation token. Keep the variables at
their defaults (or set `NPM_PROVENANCE=true`). Change `name`, `repository`,
and `homepage` in `package.json` to your fork before you publish, so that
your package does not conflict with the upstream package name.

## Publish to a private Azure Artifacts feed

Use the step-by-step guide —
**[Publishing a fork to a private Azure Artifacts feed](publishing-to-azure-artifacts.md)** —
it shows the Azure DevOps steps (create the feed, get the registry URL, set
the publish permission, make the PAT) and connects each value to the
configuration above.

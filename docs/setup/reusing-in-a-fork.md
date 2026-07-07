# Reusing the workflows in a fork

The CI and release workflows are fork-safe: nothing is hardcoded to the
upstream repository in a way that would leak or misfire. Codecov uploads use
the current repo's slug and never hard-fail a fork that has no `CODECOV_TOKEN`,
and the release job only publishes when *you* configure it — a fork that merges
a release PR without any publishing secret is skipped cleanly (it stays green
instead of failing an OIDC publish it can't perform). No workflow files need to
be edited. For the design rationale see
[ADR-0011](../decisions/0011-make-release-workflow-fork-reusable.md).

## Configuration reference

To publish from your fork, add the following under **Settings → Secrets and
variables → Actions**. The release job auto-selects token auth as soon as an
`NPM_TOKEN` secret is present, and picks the right `.npmrc` auth format from the
registry host.

| Kind | Name | Purpose |
|---|---|---|
| Secret | `NPM_TOKEN` | npm automation token, **or** — for Azure Artifacts — a Personal Access Token with the *Packaging: Read & write* scope (pass the **raw** PAT; the workflow base64-encodes it as Azure requires). |
| Variable | `NPM_REGISTRY_URL` | Target registry. Defaults to `https://registry.npmjs.org`. |
| Variable | `NPM_PUBLISH_ACCESS` | `public` (default) or `restricted`. Use `restricted` for a private feed. |
| Variable | `NPM_AUTH_STYLE` | `password` (Azure base64-PAT form) or `token` (bearer `_authToken`). Auto-detected from the registry host; set it only for a self-hosted Azure DevOps Server URL. |
| Variable | `NPM_PROVENANCE` | `true` to attach [provenance](https://docs.npmjs.com/generating-provenance-statements) on token-based npmjs.org publishes. Ignored for other registries (provenance is npm-only). |

Also enable **Allow GitHub Actions to create and approve pull requests** under
**Settings → Actions → General → Workflow permissions**, so release-please can
open its release PR on your fork.

## Publish to your own npm account

Set the `NPM_TOKEN` secret to an npm automation token. Leave the variables at
their defaults (or set `NPM_PROVENANCE=true`). Update `name`, `repository`, and
`homepage` in `package.json` to your fork before shipping so you don't clash
with the upstream package name.

## Publish to a private Azure Artifacts feed

Follow the dedicated step-by-step guide —
**[Publishing a fork to a private Azure Artifacts feed](publishing-to-azure-artifacts.md)** —
which walks through the Azure DevOps side (creating the feed, getting the
registry URL, granting publish permission, minting the PAT) and maps each value
onto the configuration above.

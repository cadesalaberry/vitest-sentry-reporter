# Publishing a fork to a private Azure Artifacts feed

This guide walks through forking `vitest-sentry-reporter` and configuring the
fork's release workflow to publish the package to an **internal (private) Azure
Artifacts npm feed** instead of the public npm registry.

You do **not** need to edit any workflow file. The release workflow
(`.github/workflows/release.yml`) already supports token-based publishing to a
custom registry; you only add a secret and a couple of variables to your fork.
For the design rationale see
[ADR-0011](../decisions/0011-make-release-workflow-fork-reusable.md); for the
short version of all fork options (including publishing to your own npm
account) see [Reusing the workflows in a fork](reusing-in-a-fork.md).

## How it works

When release-please cuts a release on your fork's `main`, the `publish` job runs.
Because you set an `NPM_TOKEN` secret, it uses token auth instead of the
upstream's OIDC Trusted Publishing, and because the registry host is
`pkgs.dev.azure.com`, it writes the `.npmrc` in the exact format Azure Artifacts
requires for a Personal Access Token: `always-auth=true` plus base64-encoded
`_password` credentials for both the `/npm/registry/` and `/npm/` feed paths.
The raw PAT is base64-encoded inside the job, referenced through an environment
variable (never written to `.npmrc` in the clear), and masked in the logs.

## Prerequisites

- An **Azure DevOps organization and project** with **Azure Artifacts** enabled.
- Permission to create an Azure Artifacts **feed** (or an existing feed you can
  publish to) and to manage its permissions.
- A **GitHub account** to host your fork.
- About 10 minutes.

## Step 1 — Fork the repository

1. Open <https://github.com/cadesalaberry/vitest-sentry-reporter>.
2. Select **Fork**, then create the fork under your account or organization.
3. Clone your fork locally if you want to make the `package.json` change in
   Step 5 from your machine (you can also edit it in the GitHub web UI).

## Step 2 — Get your feed's npm registry URL

1. In Azure DevOps, go to your project and select **Artifacts**.
2. If you don't have a feed yet, select **Create Feed**, give it a name, choose a
   **Visibility**, decide the **Scope** (project or organization), and select
   **Create**.
3. Select your feed, then select **Connect to feed** → **npm**.
4. Under **Project setup**, copy the `registry` URL. It looks like one of:

   - **Project-scoped feed:**
     `https://pkgs.dev.azure.com/<ORGANIZATION>/<PROJECT>/_packaging/<FEED>/npm/registry/`
   - **Organization-scoped feed** (no project segment):
     `https://pkgs.dev.azure.com/<ORGANIZATION>/_packaging/<FEED>/npm/registry/`

   Keep the trailing `/npm/registry/` and the trailing slash. This is the value
   for the `NPM_REGISTRY_URL` variable.

> An organization-scoped feed URL must **omit** the `<PROJECT>` segment; a
> project-scoped feed URL must **include** it. Copy the URL from the portal
> rather than assembling it by hand.

## Step 3 — Grant publish permission on the feed

Publishing requires the **Feed Publisher (Contributor)** role — a Reader or
Collaborator cannot push packages. The PAT you create in Step 4 acts **as you**,
so your own account (or whichever account mints the PAT) needs this role.

1. In **Artifacts**, select your feed, then the gear icon (**Feed settings**).
2. Select **Permissions** → **Add users/groups**.
3. Add the account that will own the PAT and assign the **Feed Publisher
   (Contributor)** role, then **Save**.

## Step 4 — Create a Personal Access Token (PAT)

1. Sign in to `https://dev.azure.com/<ORGANIZATION>`.
2. Open **User settings** (the gear icon, top right) → **Personal access
   tokens**.
3. Select **+ New Token**.
4. Give it a name (e.g. `github-actions-npm-publish`), select the **organization**
   that hosts your feed, and set an **expiration** (keep it short and plan to
   rotate — see [Security notes](#security-notes)).
5. Under **Scopes**, select **Packaging** → **Read & write**. (If you don't see
   Packaging, choose **Show all scopes** at the bottom of the dialog.)
6. Select **Create**, then **copy the token immediately** — Azure DevOps shows
   it only once. This raw token is the value for the `NPM_TOKEN` secret.

> Pass the **raw** PAT to GitHub. The workflow base64-encodes it for you (Azure
> Artifacts requires the encoded form in `.npmrc`); do not pre-encode it.

## Step 5 — Rename the package for your feed (recommended)

To avoid clashing with the public `vitest-sentry-reporter` name — especially if
your feed has an npmjs.com upstream source — scope the package to your
organization. In your fork's `package.json`:

```jsonc
{
  // e.g. @your-org/vitest-sentry-reporter
  "name": "@<your-scope>/vitest-sentry-reporter",
  // optional: point these at your fork
  "repository": { "type": "git", "url": "git+https://github.com/<you>/vitest-sentry-reporter.git" },
  "homepage": "https://github.com/<you>/vitest-sentry-reporter#readme"
}
```

Commit this change to your fork's `main` (through a PR, so the PR-title check and
release-please stay happy). Scoping also makes the `restricted` access level in
Step 6 meaningful and lets consumers map the scope to your feed (see
[Consuming the package](#consuming-the-package)).

## Step 6 — Configure the fork's secret and variables

In your fork on GitHub, go to **Settings → Secrets and variables → Actions**.

Add one **secret** (the **Secrets** tab → **New repository secret**):

| Name | Value | Where it comes from |
| --- | --- | --- |
| `NPM_TOKEN` | your raw Azure DevOps PAT | Step 4 |

Add these **variables** (the **Variables** tab → **New repository variable**):

| Name | Value | Where it comes from |
| --- | --- | --- |
| `NPM_REGISTRY_URL` | your feed's npm `registry` URL | Step 2 |
| `NPM_PUBLISH_ACCESS` | `restricted` | private feed → restricted |
| `NPM_AUTH_STYLE` | *(only for Azure DevOps **Server**)* `password` | see note below |

Notes:

- `NPM_AUTH_STYLE` is **not needed** for Azure DevOps Services
  (`pkgs.dev.azure.com`) or `*.pkgs.visualstudio.com` — the workflow detects
  those hosts automatically. Set it to `password` only if your feed is on a
  **self-hosted Azure DevOps Server** with a different hostname.
- Leave `NPM_PROVENANCE` unset. Provenance is an npmjs.org-only feature and is
  ignored for Azure feeds.

## Step 7 — Allow release-please to open its release PR

Releases are automated with release-please, which opens a "release PR" that bumps
the version and updates `CHANGELOG.md`. For it to work on your fork:

1. Go to **Settings → Actions → General → Workflow permissions**.
2. Enable **Allow GitHub Actions to create and approve pull requests**.

## Step 8 — Cut a release

1. Merge a change into your fork's `main` using a
   [Conventional Commit](../COMMIT_CONVENTION.md) message (`feat:` → minor,
   `fix:` → patch). release-please opens or updates a release PR.
2. When you're ready to ship, merge the release PR. That creates the `vX.Y.Z`
   tag and GitHub release, and triggers the `publish` job.
3. Watch **Actions → Release**. In the **Publish** step you should see:

   ```
   Publishing to Azure Artifacts feed https://pkgs.dev.azure.com/.../npm/registry/ (access=restricted).
   ```

   followed by npm's publish output. The package now appears in your feed under
   **Artifacts**.

## Consuming the package

Consumers point npm at your feed and authenticate with their own PAT (or, inside
Azure Pipelines, the `npmAuthenticate@0` task). A minimal project `.npmrc`:

```ini
; map your scope to the feed (npm allows only one default registry)
@<your-scope>:registry=https://pkgs.dev.azure.com/<ORGANIZATION>/<PROJECT>/_packaging/<FEED>/npm/registry/
always-auth=true
```

Each developer then adds their own base64-encoded PAT to their **user-level**
`~/.npmrc` (never commit credentials) exactly as the
[Azure Artifacts npm docs][azure-npmrc] describe, or runs `vsts-npm-auth`
(Windows). Then:

```bash
npm install @<your-scope>/vitest-sentry-reporter
```

## Troubleshooting

- **401 Unauthorized** — the PAT is wrong, expired, or lacks scope. Confirm it
  has **Packaging: Read & write** and hasn't expired, and that `NPM_TOKEN` holds
  the **raw** PAT (the workflow encodes it; a pre-encoded value would be
  double-encoded).
- **403 Forbidden** — authentication worked but the identity can't publish. Give
  the PAT owner the **Feed Publisher (Contributor)** role (Step 3).
- **404 / ENOTFOUND / wrong registry** — re-copy the `registry` URL from
  **Connect to feed** (Step 2). Project-scoped URLs include `/<PROJECT>/`;
  org-scoped URLs must not.
- **Publish is skipped entirely** — the job only publishes when `NPM_TOKEN` is
  set (or on the upstream repo). Confirm the secret exists on the fork and that
  the release PR was actually merged (the job runs only when release-please cut a
  release).
- **`EPUBLISHCONFLICT` / version already exists** — that version is already in
  the feed. Let release-please bump the version (Azure feeds are immutable per
  version) rather than republishing.
- **Self-hosted server auth fails** — set `NPM_AUTH_STYLE=password` so the job
  uses the base64-PAT format on a non-`pkgs.dev.azure.com` host.

## Security notes

- A PAT is a long-lived credential tied to your user. Use a **short expiration**,
  the **minimum scope** (Packaging: Read & write only), and rotate it regularly;
  re-mint it and update the `NPM_TOKEN` secret before it expires.
- Prefer a dedicated service/bot account for the PAT so publishing doesn't break
  when a person leaves, and so the audit trail is clear.
- Never commit a PAT or a populated `.npmrc`. GitHub masks the secret in logs,
  and this workflow additionally masks the derived base64 value.
- Microsoft recommends [Microsoft Entra tokens, service principals, or managed
  identities][pat-guidance] over PATs where possible. This workflow uses a PAT
  because it authenticates from GitHub Actions (outside Azure DevOps); if you run
  releases from Azure Pipelines instead, prefer the `npmAuthenticate@0` task.

## References

- Azure Artifacts — connect to a feed (npm `.npmrc` format): [learn.microsoft.com][azure-npmrc]
- Azure Artifacts — publish and download npm packages: <https://learn.microsoft.com/en-us/azure/devops/artifacts/get-started-npm>
- Azure Artifacts — manage feed permissions (roles): <https://learn.microsoft.com/en-us/azure/devops/artifacts/feeds/feed-permissions>
- Azure DevOps — use personal access tokens: [learn.microsoft.com][pat-guidance]
- GitHub Actions — variables and secrets: <https://docs.github.com/actions/learn-github-actions/variables>
- [Reusing the workflows in a fork](reusing-in-a-fork.md)
- [ADR-0011: Make the release workflow reusable by forks](../decisions/0011-make-release-workflow-fork-reusable.md)

[azure-npmrc]: https://learn.microsoft.com/en-us/azure/devops/artifacts/npm/npmrc
[pat-guidance]: https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate

# One-time repository setup (upstream)

One-time configuration for the canonical `cadesalaberry/vitest-sentry-reporter`
repository — or for anyone standing up their own canonical copy that publishes
to the public npm registry via Trusted Publishing. Forks don't need any of
this; see [Reusing the workflows in a fork](reusing-in-a-fork.md) instead.

## Configure npm Trusted Publishing

Publishing to npm uses [Trusted Publishing (OIDC)][trusted-publishers]: npm
exchanges the GitHub Actions OIDC token for a short-lived, scoped publish
credential and attaches [build provenance][provenance] automatically. There is
no `NPM_TOKEN` secret to store or rotate, and publishing is not blocked by
account 2FA.

1. On npmjs.com, open the package → **Settings** → **Trusted Publishers**.
2. Add a **GitHub Actions** publisher for:
   - Repository: `cadesalaberry/vitest-sentry-reporter`
   - Workflow: `release.yml`

The Trusted Publisher keys off the repository and workflow *file* name, not the
job id inside it.

## Allow release-please to open its release PR

release-please maintains the release PR with the default `GITHUB_TOKEN`, which
needs permission to create pull requests:

1. Go to **Settings → Actions → General → Workflow permissions**.
2. Enable **Allow GitHub Actions to create and approve pull requests**.

## References

- [ADR-0006: Automate releases with release-please and Conventional Commits](../decisions/0006-automate-releases-with-release-please.md)
- npm trusted publishing (OIDC): [docs.npmjs.com][trusted-publishers]
- npm provenance: [docs.npmjs.com][provenance]

[trusted-publishers]: https://docs.npmjs.com/trusted-publishers
[provenance]: https://docs.npmjs.com/generating-provenance-statements

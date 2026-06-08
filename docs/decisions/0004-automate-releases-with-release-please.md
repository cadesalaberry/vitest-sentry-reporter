# Automate releases with release-please and Conventional Commits

- Status: accepted
- Date: 2026-06-08

## Context

The project already follows [Conventional Commits](https://www.conventionalcommits.org/)
with Gitmoji (see `docs/COMMIT_CONVENTION.md`), but versioning was entirely
manual: there were no git tags, no `CHANGELOG.md`, and publishing to npm was a
manual step. Manual bumps are easy to forget, drift from the commit history,
and make the changelog inconsistent.

We want the version to be derived automatically from the commit history so that:

- `feat:` commits trigger a minor bump, `fix:` a patch, and `!`/`BREAKING CHANGE:` a major.
- A `CHANGELOG.md` is generated and kept in sync with the bumps.
- Publishing to npm happens automatically once a release is cut.

The repository uses Bun as its package manager (ADR-0001), so we prefer a
solution that does not add Node release tooling as project dependencies.

## Decision

Adopt [release-please](https://github.com/googleapis/release-please) driven by a
GitHub Actions workflow (`.github/workflows/release.yml`).

- On every push to `main`, release-please maintains a "release PR" that bumps
  `version` in `package.json` and updates `CHANGELOG.md` from Conventional
  Commits. Merging that PR creates the git tag (`vX.Y.Z`) and GitHub release.
- Configuration lives in `release-please-config.json` (release type `node`,
  single root package, Gitmoji-flavored changelog sections) and the current
  version is tracked in `.release-please-manifest.json`.
- `bootstrap-sha` anchors the existing `1.0.0` to the current `main` tip so the
  first release PR only contains commits made after this system was introduced,
  rather than re-listing the whole history.
- When release-please cuts a release, a second job publishes to npm with
  `npm publish --provenance` (using `id-token: write` for provenance and the
  `NPM_TOKEN` secret for authentication).

Gitmoji placed after the `type(scope):` prefix does not interfere with commit
parsing — the type/scope are read from the prefix, and the emoji simply appears
in the changelog description, which matches the project's existing style.

### Required repository configuration

- **`NPM_TOKEN`** secret: an npm automation/granular token with publish access.
- **Allow GitHub Actions to create and approve pull requests**: enable under
  Settings → Actions → General → Workflow permissions, otherwise release-please
  cannot open its release PR with the default `GITHUB_TOKEN`.

## Consequences

- Versioning and changelog generation are automatic and consistent with the
  commit history; humans still control *when* to release by merging the PR.
- No release tooling is added to the project's dependencies — release-please
  runs entirely as a GitHub Action.
- Releases are reproducible and publish with npm provenance, improving
  supply-chain transparency.
- Contributors must keep following the Conventional Commits convention; commits
  that do not match a releasable type will not trigger a bump.
- Release PRs opened by the default `GITHUB_TOKEN` do not themselves trigger the
  CI workflow. CI already runs on the underlying feature commits; if CI on the
  release PR is desired later, switch release-please to a PAT or app token.

## References

- release-please: https://github.com/googleapis/release-please
- release-please-action: https://github.com/googleapis/release-please-action
- Conventional Commits: https://www.conventionalcommits.org/
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- ADR-0001: Adopt Bun as the package manager and runtime
- `docs/COMMIT_CONVENTION.md`

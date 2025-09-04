# Adopt Bun as the package manager and runtime

- Status: accepted
- Date: 2025-09-03

## Context

This repository is an npm package intended for publication. We want a fast developer experience (installs, scripts) and a single lockfile. Bun provides an all-in-one toolchain (runtime, test runner, bundler, package manager) with strong Node compatibility, which fits this project well.

## Decision

- Use Bun as the primary package manager for this repo.
- Specify the required Bun version in `package.json` `engines.bun` and set `packageManager: bun@<version>`.
- Generate and commit `bun.lockb` for reproducible installs.
- Maintain Node compatibility via a CommonJS entry (`index.js`) so the package can be consumed by Node/Vitest users.
- Continue to publish to the public npm registry.

## Consequences

- Faster installs and scripts with Bun.
- One lockfile (`bun.lockb`) maintained in the repo.
- Contributors need Bun installed locally; Node remains supported for consumers of the published package.
- CI should use Bun for install and scripts.

## References

- Bun: https://bun.sh/
- npm Publishing Guide: https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages
- Vitest reporters: https://vitest.dev/guide/reporters.html

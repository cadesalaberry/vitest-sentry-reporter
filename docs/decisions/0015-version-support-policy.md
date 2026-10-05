---
title: Define a version support policy and raise the Node floor to 20.19
status: accepted
date: 2026-10-05
authors:
  - cadesalaberry
---

## Context

- The reporter depends on three things it does not control: Node, Vitest
  (peer `>=3.0.0`) and the Sentry Node SDK (peer `>=10.0.0`). Each one
  releases a new major about once a year.
- Before this ADR there was no rule that said which versions we support, or
  when we stop supporting one. Each change was a new discussion (ADR 0004,
  ADR 0005).
- `engines.node` said `>=18`, but no CI leg ran Node 18. The oldest tested
  Node was 20. The claim was not verified.
- Node 18 reached end of life on 2025-04-30 and Node 20 on 2026-04-30.
  `@sentry/node` 11 requires Node `>=20.19.0`, and so does Vite 7, which CI
  uses to run every leg. A consumer on Node 18 cannot run the current
  versions of our peers.
- The peer ranges have no upper bound. A new Vitest or Sentry SDK major can
  reach consumers before CI tests it.

## Decision

Support policy:

- **Peer majors.** We support every major of `vitest` and `@sentry/node` that
  the peer ranges accept, from the lowest major up to the newest stable
  release. The CI matrix in `.github/workflows/ci.yml` runs at least one leg
  for each of these majors. A new major is supported when its CI leg passes.
- **Upper bound.** The peer ranges stay open (`>=`). The weekly canary
  workflow (`.github/workflows/canary.yml`) tests the `latest` versions of the
  peers and of Node, so a breaking upstream major shows up within a week. If
  a new major breaks the reporter and no fix is ready, cap the peer range
  below that major in a `fix:` release, then remove the cap when the fix
  ships.
- **Node floor.** `engines.node` is the oldest Node version that a CI leg
  runs. It is the highest of these minimums: the oldest supported Vitest
  major, the oldest supported Sentry SDK major, and the toolchain that CI
  uses on its oldest leg (today Vite 7). The floor is never lower than a
  version that CI tests.
- **Dropping a version.** Drop a Node, Vitest or Sentry SDK major only in a
  breaking release (`feat!:`), and only when one of these is true:
  - Upstream no longer supports it, or
  - Keeping it blocks a change that consumers on supported versions need.
  Record each drop in the CHANGELOG through the `BREAKING CHANGE:` footer.

Change now:

- Raise `engines.node` from `>=18` to `>=20.19.0`, the minimum of
  `@sentry/node` 11 and Vite 7.
- Pin the Node 20 CI legs to `20.19`, so CI tests the floor and not only the
  newest Node 20 patch.
- Keep Vitest 3 and `@sentry/node` 10: both still run on the new floor, and
  removing them gives no benefit to consumers yet.

## Consequences

- The engines claim matches what CI tests.
- Consumers on Node 18, or on Node 20 before 20.19.0, get an engines warning
  (npm) or an install error (with `engine-strict`). They must stay on 2.x.
- This is a breaking change, so the next release is a major (3.0.0).
- A drop of a version, or a new major, now follows a written rule. It no
  longer needs a new ADR, unless the rule itself changes.

## References

- ADR 0004: migrate to the Vitest 4 reported-tasks API
- ADR 0005: support Vitest 3
- Node.js release schedule: https://github.com/nodejs/release#release-schedule
- `@sentry/node` 11 `engines`: `>=20.19.0 <22.0.0 || >=22.12.0 <23.0.0 || >=23.2.0`

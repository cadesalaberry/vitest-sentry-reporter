---
title: Pseudonymise the reported identity to count distinct developers
status: accepted
date: 2026-09-01
authors:
  - cadesalaberry
---

## Context

- The `identity` option populates the Sentry user with the developer who
  triggered the run. Sentry counts distinct users per issue, so a failing test
  reports "N users affected". That number ranks failures by the number of
  developers that they block, which is the signal a team needs to prioritize.
- The values sent are direct identifiers: a login name, sometimes an account id,
  and, on request, an email. A name and an email are personal data under the
  GDPR. Many teams cannot send them to a Sentry organization that they do not
  control.
- The existing `hash` option does not answer that case. It hashes the id and the
  email, and it keeps the username readable on purpose, because the username is
  the searchable handle in Sentry.
- The result is all-or-nothing. A team that must not send names turns `identity`
  off, and the count disappears with it. The team loses the prioritization
  signal to protect data that it never wanted to send in the first place.
- The count itself does not need a name. It needs one value per developer that
  stays the same across runs.

## Decision

- Add `pseudonymise` to the `identity` options, a boolean that defaults to
  `false`. Behavior is unchanged for every current user.
- When the option is on, `detectIdentity` returns one field: an `id` of the form
  `dev-<16 hex characters>`. The name and the email stay on the machine.
- The id is `dev-` plus the first 16 characters of the SHA-256 digest of a seed.
  The seed is the most stable identifier available, in this order: the email,
  then the CI account id, then the username. The seed is trimmed and lowercased,
  so one developer always gets one id.
- 16 hex characters carry 64 bits, which does not collide at team scale. The
  `dev-` prefix marks the value as derived, so a reader does not mistake it for
  a real account id.
- `pseudonymise` takes precedence over `includeEmail` and `hash`. A pseudonym
  replaces the identity, so the options that shape the name and the email no
  longer apply.
- The reporter needs no change. The `triggered_by` tag already falls back from
  the username to the id, so the tag carries the pseudonym.

## Consequences

- A privacy-averse team keeps the "users affected" count, and Sentry receives no
  name and no email.
- Attribution is traded for the count. The Sentry issue no longer says who
  triggered the run. The digest is reproducible, so a maintainer who holds the
  team emails can map an id back to a person offline.
- The seed can be the email even when `includeEmail` is `false`. The digest is
  opaque and the email itself is never sent, so the two options do not conflict.
- A pseudonym is not anonymous data. An attacker who holds a list of candidate
  emails can enumerate the digests. The option lowers exposure. It does not make
  the data anonymous under the GDPR.
- The id follows the seed, and the seed follows the source. GitHub Actions
  exposes an account id and no email, so the id from a GitHub Actions run
  differs from the id of the same developer on a local run. One developer who
  runs tests in both places can count as two users. Set `source: 'ci'` when the
  count must cover CI runs only.
- Providers that expose an email (GitLab, Jenkins, Buildkite) seed on the email,
  which matches the local git author. Their ids are stable across CI and local
  runs.

## Alternatives

- **Reuse `hash: true`**: rejected. It keeps the username readable by design, so
  names still reach Sentry.
- **Hash all three fields and keep them**: rejected. Sentry needs one identifier
  for the count. Three digests add no information and widen the surface that an
  attacker can enumerate.
- **A random id per run**: rejected. The count then equals the number of runs,
  not the number of developers.
- **A random id stored on the machine**: rejected. It counts machines, not
  developers, and CI runners are ephemeral. It also needs state and a write path
  that a reporter must not require.
- **A configurable salt**: rejected for now. A salt raises the cost of
  enumeration, and it breaks the offline mapping and adds a secret to
  distribute. The object form `pseudonymise: { salt }` stays open for later.
- **The full 64-character digest**: rejected. The value is visible in the Sentry
  UI and in the `triggered_by` tag, where 16 characters stay readable and
  unique enough.
- **The spelling `pseudonymize`**: rejected. The GDPR term is
  "pseudonymisation" (Article 4(5)), and one spelling per concept keeps the API
  and the documentation consistent.

## Tests

- `src/identity.test.ts` covers the seed order (email, then id, then username),
  the stability of the id for one developer, the precedence over `includeEmail`
  and `hash`, the git author whose email is otherwise dropped, and the case
  where nothing resolves.
- `src/reporter.test.ts` covers the pass-through of the option and asserts that
  the Sentry user carries only the pseudonymous id, and that `triggered_by`
  carries the same value.

## References

- [README: Count distinct developers without names](../../README.md#count-distinct-developers-without-names-pseudonymise)
- [`src/identity.ts`](../../src/identity.ts) and [`src/types.ts`](../../src/types.ts)
- [GDPR Article 4(5): definition of pseudonymisation](https://gdpr-info.eu/art-4-gdpr/)
- [Sentry: identify users](https://docs.sentry.io/platforms/javascript/enriching-events/identify-user/)

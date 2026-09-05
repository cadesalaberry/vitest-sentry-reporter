---
title: Rationalise identity into one level, pseudonymous by default
status: accepted
date: 2026-09-05
authors:
  - cadesalaberry
---

# Rationalise identity into one level, pseudonymous by default

## Context

Version 1.5.0 added the `identity` option. It attributes a failing test to the
developer who triggered the run, and it drives Sentry's "users affected" metric.
The option shipped as four independent knobs:

```ts
identity: {
  source: 'ci' | 'commit-author' | 'both',
  includeEmail: boolean,
  hash: boolean,
  pseudonymise: boolean, // proposed, never released
}
```

That surface has four problems.

1. The feature is off by default. A new user gets no distinct-user count, and the
   metric that motivates the feature stays empty.
2. `identity: true` sends the git author name. A real name is personal data, so
   the simplest spelling of the option is also the one that leaks the most.
3. Three knobs control privacy, and they overlap. The reader must learn the
   precedence rules between `includeEmail`, `hash` and `pseudonymise`.
4. `hash` hashes the id and the email, and leaves the username readable. On a
   local run the identity is usually a username alone, so `hash: true` changes
   nothing. The option promises protection that it does not deliver.

The team wants attribution out of the box, and no personal data out of the box.

## Decision

Replace the three privacy knobs with one ordered level, and turn the feature on.

```ts
type IdentityLevel = 'pseudonym' | 'username' | 'email';

identity?: IdentityLevel | false | { level?: IdentityLevel; source?: IdentitySource };
```

- The default is `'pseudonym'`. Sentry receives `{ id: 'dev-<16 hex>' }`, which
  carries no name and no email.
- `'username'` adds the login and the CI account id. `'email'` adds the address.
  Each level adds to the level before it, so one value states exactly what
  leaves the machine.
- `false` disables detection, the Sentry user and the `triggered_by` tag.
- `source` stays, because it answers a different question: which signal to read,
  not how much of it to send.
- `includeEmail`, `hash` and `pseudonymise` are removed. `includeEmail: true`
  becomes `'email'`. `hash: true` and `pseudonymise: true` become `'pseudonym'`.

The pseudonym is the first 16 characters of a SHA-256 digest, with a `dev-`
prefix. The seed is the most stable identifier available: the email, then the CI
account id, then the username. The seed is trimmed and lowercased, so one
developer gets one id across runs.

The reporter accepts any unexpected value as the default level. A stale
`identity: true` from version 1.5.0 therefore sends a pseudonym, and never more.

## Consequences

- A new user gets a correct count of distinct developers with zero configuration,
  and sends no personal data to Sentry.
- The option surface drops from four knobs to two, and the privacy knob is a
  single ordered ladder. The unsafe values are the explicit ones.
- The change breaks the 1.5.0 API. `includeEmail` and `hash` no longer exist, and
  the default behavior changes from "off" to "pseudonymous". The release is a
  major version, and the release notes carry the mapping above.
- The id is pseudonymous and not anonymous. The digest is unsalted, so a party
  who holds the list of team emails can match an id to a person. That property is
  deliberate, because it lets a maintainer map an id back offline. Treat the id
  as personal data under the GDPR.
- The id follows the seed, and the seed follows the source. GitHub Actions
  exposes an account id and no email, so the same developer gets one id in a
  GitHub Actions run and another id on a local run. GitLab, Jenkins and Buildkite
  expose an email, so their ids match the local one. `source: 'commit-author'`
  gives one id everywhere.

## Alternatives considered

- **Keep the feature off by default.** Rejected. The metric is the reason for the
  feature, and an off-by-default metric stays empty. A safe default lets the
  feature run without a privacy review.
- **Keep `pseudonymise` as a boolean.** Rejected. A boolean does not scale to
  three levels, and it leaves the reader with the precedence rules.
- **Keep the old keys as deprecated aliases.** Rejected. The keys shipped four
  days before this decision, so adoption is near zero. A compatibility layer
  would double the documented surface for a surface that nobody depends on.
- **Name the default `'anonymous'`.** Rejected. The id is reversible with a list
  of candidate emails, so `'anonymous'` overstates the protection.
- **Salt the digest per project.** Rejected. A salt breaks the offline mapping,
  changes every id when it rotates, and adds the knob that this decision removes.
- **Send a random id per run.** Rejected. The count would equal the number of
  runs, not the number of developers.
- **Send the full 64-character digest.** Rejected. 64 bits do not collide at team
  scale, and the short id stays readable in the Sentry interface.
- **Spell the level `'pseudonymous'`.** Rejected. `'pseudonym'` names the value
  that Sentry receives, and it matches `'username'` and `'email'`, which name
  their values too.

## Tests

`src/identity.test.ts` covers the default level, the three levels, the seed
order, the stability of the id across case and whitespace, and the case where
nothing resolves. `src/reporter.test.ts` covers the default pass-through, the
string shorthand, the object form, the `triggered_by` tag and `identity: false`.

## References

- [ADR 0008](0008-resolve-codeowners-into-sentry-tags.md) for the other
  attribution signal.
- [Sentry user documentation](https://docs.sentry.io/platforms/javascript/enriching-events/identify-user/)

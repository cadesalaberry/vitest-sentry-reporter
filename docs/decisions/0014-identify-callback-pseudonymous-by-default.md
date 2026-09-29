---
title: Pick the Sentry user with an identify callback, pseudonymous by default
status: accepted
date: 2026-09-29
authors:
  - cadesalaberry
---

# Pick the Sentry user with an identify callback, pseudonymous by default

## Context

Version 1.5.0 added the `identity` option. It attributes a failed test to a
developer, and it drives Sentry's "users affected" metric. The option shipped
as four knobs:

```ts
identity: boolean | {
  source: 'ci' | 'commit-author' | 'both',
  includeEmail: boolean,
  hash: boolean,
}
```

That surface has four problems.

1. The feature is off by default. A new user gets no count of distinct
   developers, and the metric that motivates the feature stays empty.
2. `identity: true` sends the git author name. A real name is personal data,
   so the simplest spelling of the option also leaks the most.
3. Two knobs control privacy, and a third knob controls the source. The reader
   must learn how they combine.
4. `hash` hashes the id and the email, and leaves the username readable. On a
   local run the identity is usually a username alone, so `hash: true` changes
   nothing.

The default source `'both'` adds a fifth problem. In CI it picks the
trigger-er, and on a local run it picks the git author. GitHub Actions exposes
an account id and no email for the trigger-er. One developer therefore gets two
different ids, and Sentry counts that developer twice.

The team wants attribution out of the box, no personal data out of the box, and
one concept to learn.

## Decision

Replace `identity` with one callback, and detect both candidates for it.

```ts
identify?: ((detected: DetectedIdentities) => SentryUser | undefined) | false;

type DetectedIdentities = { ci?: DetectedIdentity; commitAuthor?: DetectedIdentity };
type DetectedIdentity = { id: string; username?: string; email?: string };
```

- The reporter detects two candidates once per run: `ci`, the CI trigger-er,
  and `commitAuthor`, the author of the last non-merge commit, else
  `git config user.*`, else the OS username.
- Each candidate `id` is a pseudonym: `dev-` and the first 16 hex characters of
  a SHA-256 digest. The seed is the email, then the CI account id, then the
  username, trimmed and lowercased. The raw account id never reaches the
  callback.
- The default is `({ commitAuthor }) => commitAuthor && { id: commitAuthor.id }`.
  Sentry receives one opaque id, and no name and no email.
- The callback returns the Sentry user. Each field that it returns reaches
  Sentry, so the personal data in the payload is exactly what the config
  writes.
- `false` skips the detection, the Sentry user and the `triggered_by` tag.
- A callback that throws sends the failure with no user and logs one warning.
  A value that is not a function and not `false` falls back to the default.
- Automation bots and AI agents are excluded: both candidates are absent.

## Consequences

- A new user gets a correct count of distinct developers with zero
  configuration, and sends no personal data to Sentry.
- One concept replaces four knobs. Each mix of source and detail is one line,
  for example the pseudonym and the name of the commit author.
- The default seed is the git email both in CI and on a local run, so one
  developer gets one id everywhere. The double count of the `'both'` source
  goes away.
- The id is pseudonymous and not anonymous. The digest is unsalted, so a party
  who holds the list of team emails can match an id to a person. That property
  is deliberate, because it lets a maintainer map an id back offline. Treat the
  id as personal data under the GDPR.
- The `ci` candidate has no email on GitHub Actions, so its id differs from the
  commit author id of the same person. A callback that mixes the candidates
  counts one developer twice. The documentation says to pick one candidate.
- On a local run, the last non-merge commit can belong to another developer,
  for example right after a pull. The failure then counts against that author.
- The change breaks the 1.5.0 API. `identity`, `includeEmail`, `hash` and
  `source` no longer exist, and `detectIdentity` becomes `detectIdentities`.
  The default changes from "off" to "pseudonym of the commit author". The
  release is a major version.
- `identify` and `getUser` both return a Sentry user. `getUser` runs per
  failure and wins. A later change can fold `getUser` into `identify`.

## Alternatives considered

- **Keep the 1.5.0 flags.** Rejected for the problems in the context.
- **One ordered level, `'pseudonym' | 'username' | 'email'`, plus `source`.**
  This shape was the first draft of this decision. Rejected, because two enums
  fix the choices in advance. They cannot express a mix such as the pseudonym
  of the commit author with the name of the CI trigger-er, and the reader still
  learns two axes. One callback covers both axes and keeps a safe default.
- **Keep `source` next to the callback.** Rejected. The callback picks the
  candidate, so `source` says the same thing twice.
- **The CI trigger-er as the default.** Rejected. Its seed on GitHub Actions is
  the account id, and a local run has no trigger-er. The commit author email is
  present in both places.
- **Pass the raw account id to the callback.** Rejected. An `id` that is always
  a pseudonym makes `{ id }` safe to send by construction.
- **Keep the feature off by default.** Rejected. An off-by-default metric stays
  empty, and a safe default lets the feature run without a privacy review.
- **Salt the digest per project.** Rejected. A salt breaks the offline mapping,
  changes every id when it rotates, and adds a knob.
- **Send a random id per run.** Rejected. The count equals the number of runs,
  not the number of developers.
- **Send the full 64-character digest.** Rejected. 64 bits do not collide at
  team scale, and the short id stays readable in the Sentry interface.

## Tests

`src/identity.test.ts` covers the two candidates, the seed order, the stability
of the id across case and whitespace, the fallback chain, the bot and AI
exclusion, and the case where nothing resolves. `src/reporter.test.ts` covers
the default, a custom callback and its argument, `false`, a value that is not a
function, an empty return, a callback that throws, the precedence of `getUser`,
the manual `triggered_by` tag, and the single resolution per run.

## References

- [ADR 0008](0008-resolve-codeowners-into-sentry-tags.md) for the other
  attribution signal.
- [Sentry user documentation](https://docs.sentry.io/platforms/javascript/enriching-events/identify-user/)

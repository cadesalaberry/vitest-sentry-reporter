---
title: Pick the Sentry user with a getUser callback, pseudonymous by default
status: accepted
date: 2026-09-30
authors:
  - cadesalaberry
---

# Pick the Sentry user with a getUser callback, pseudonymous by default

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

A second option, `getUser(ctx)`, also returns the Sentry user. It runs for
each failure and wins over `identity`. Two options set one field, with a
precedence rule between them.

The team wants attribution out of the box, no name and no email out of the
box, and one concept to learn. The package has no users yet, so the change can
break the API freely.

## Decision

Replace `identity` with one callback, `getUser`, and pass it two detected
people before the failure context. The name matches `getTags` and
`getFingerprint`.

```ts
getUser?:
  | ((detected: DetectedIdentities, ctx: FailureContext) => SentryUser | undefined)
  | false;

type DetectedIdentities = { developer?: DetectedIdentity; committer?: DetectedIdentity };
type DetectedIdentity = { id?: string; username?: string; email?: string; pseudonymizedId: string };
```

- `developer` is the person who ran the tests. In CI, it is the account that
  triggered the run, from the CI provider. Outside CI, it is
  `git config user.*`, else the OS username. It is absent when a bot or an AI
  agent runs the tests.
- `committer` is the person behind the latest commit: the committer of `HEAD`,
  else its author. GitHub (`noreply@github.com`), `*[bot]` accounts and AI
  agents do not count. `HEAD` carries its own metadata, so the result does not
  depend on the checkout depth.
- Each candidate keeps the `id`, `username` and `email` that the source
  exposes. `pseudonymizedId` is `dev-` and 16 hex characters of the SHA-256
  digest of the email, else the username, else the account id, trimmed and
  lowercased.
- The default sends `{ id: pseudonymizedId }` of `developer`, else of
  `committer`. A run that a bot triggers, for example a merge queue, therefore
  counts the person behind the change.
- The reporter detects the people once per run, on the first failure. It calls
  the callback for each failure, with the detection and the failure context.
- `false` skips the detection, the Sentry user and the `triggered_by` tag. A
  callback that throws, or that returns a truthy value that is not a Sentry
  user, sends the failure with no user and logs one warning. A leftover 1.5.0
  `identity` key logs one warning.
- The GitHub Actions provider pairs `GITHUB_ACTOR` with `GITHUB_ACTOR_ID`, so
  the username and the id always describe one account. A re-run keeps the
  original actor, because GitHub exposes no id for `GITHUB_TRIGGERING_ACTOR`.

## Consequences

- A new user gets a count of the developers that each failure affects, with
  zero configuration.
- The default sends pseudonymous personal data. A privacy review is still
  necessary before the upgrade, because the default makes that decision for
  every consumer.
- The release notes must say that 2.0 sends a Sentry user by default, and that
  it runs `git log -1`, and `git config` outside CI, on the first failure. By
  default, 1.5.0 sent no user and ran no git command.
- A developer and a committer with one email get one pseudonymized id.
- One person can get two ids: a GitHub login in CI and a git email locally, or
  two emails. A filter on the Sentry environment counts each context on its
  own.
- The callback receives the raw fields. A function that returns them sends
  them, for example the public GitHub account id.
- The digest is unsalted, so a party who holds the list of team emails or
  logins can match an id to a person. Treat the id as personal data under the
  GDPR.

## Alternatives considered

- **Keep the 1.5.0 flags.** Rejected for the problems in the context.
- **One ordered level, `'pseudonym' | 'username' | 'email'`, plus `source`.**
  The first draft. Rejected, because two enums fix the choices in advance.
- **The last non-merge commit author as the default.** The second draft.
  Rejected after review. `git log -1 --no-merges` returns the synthetic merge
  commit in a shallow clone of a pull request merge ref, and the head commit in
  a full clone. Bot and AI authors also come back through git.
- **`HEAD^2` on a merge commit.** Rejected. In a depth-1 clone, `HEAD^2` does
  not resolve. After a local `git merge main`, it points to the base branch.
- **The git committer field alone.** Rejected. GitHub is the committer of all
  of the last 20 commits on `main`, so every developer would share one id.
- **The committer as the first choice.** Rejected. It names who changed the
  code, and the metric counts who ran the tests. It stays the fallback.
- **Replace the raw `id` with the pseudonym.** The third draft. Rejected in
  review, because the callback lost the account id.
- **Seed by the key that Sentry uses to count users** (`id`, else `username`,
  else `email`, from `EventUser.tag_value`). Tried after review, then dropped
  by the owner. A local seed would be the git name, which is less precise than
  the git email.
- **`GITHUB_TRIGGERING_ACTOR`, with the id only when it is `GITHUB_ACTOR`.**
  Rejected in review. A re-run by another person loses the account id.
- **A separate `identify` callback next to `getUser`.** A draft of this
  decision. Rejected. Two callbacks return the same user with a precedence
  rule.
- **`getUser(ctx, detected)`, with the context first like `getTags`.**
  Rejected. Most functions read only the detected people, so the detection
  comes first.
- **Keep the feature off by default.** Rejected. An off-by-default metric stays
  empty.
- **Salt the digest, send a random id per run, or send the full digest.**
  Rejected. A salt breaks the offline mapping. A random id counts runs, not
  developers. 64 bits do not collide at team scale.

## Tests

`src/identity.test.ts` covers the seed order and its normalization, the raw
fields, one id for a developer and a committer with one email, the CI
trigger-er, a CI without a trigger-er, the git user, the OS user fallback, the
committer and its author fallback, the exclusion of GitHub, bots and AI agents,
and the case where nothing resolves. `src/identity.git.test.ts` runs a real git
on a pull request merge ref, cloned shallow and in full. It checks that both
clones give the same developer and the same committer, and that a bot at
`HEAD` gives no committer. `src/reporter.test.ts` covers the default and its
committer fallback, the callback arguments, a different user per failure,
`false`, the wrong return shapes, a callback that throws, the leftover 1.5.0
keys, the manual `triggered_by` tag, and the single detection per run.
`src/ci-providers/github.test.ts` covers the actor and id pairing.

## References

- [ADR 0008](0008-resolve-codeowners-into-sentry-tags.md) for the other
  attribution signal.
- [Sentry user documentation](https://docs.sentry.io/platforms/javascript/enriching-events/identify-user/)
- `EventUser.tag_value` in
  [getsentry/sentry `src/sentry/utils/eventuser.py`](https://github.com/getsentry/sentry/blob/master/src/sentry/utils/eventuser.py):
  how Sentry counts distinct users.
- GDPR [Article 4(5)](https://gdpr-info.eu/art-4-gdpr/) and
  [Recital 26](https://gdpr-info.eu/recitals/no-26/): pseudonymised data is
  personal data.

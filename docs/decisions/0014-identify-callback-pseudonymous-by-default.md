---
title: Pick the Sentry user with an identify callback, pseudonymous by default
status: accepted
date: 2026-09-30
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

A second callback, `getUser(ctx)`, also returns the Sentry user. It runs for
each failure and wins over `identity`. Two options set one field, with a
precedence rule between them.

The metric counts the developers that a failed test blocks. The blocked
developer is the person who ran the tests. That person is not always the
author of the code under test.

The team wants attribution out of the box, no name and no email out of the
box, and one concept to learn.

## Decision

Replace `identity` and `getUser` with one callback, and detect the developer
who ran the tests for it.

```ts
identify?:
  | ((detected: DetectedIdentities, ctx: FailureContext) => SentryUser | undefined)
  | false;

type DetectedIdentities = { developer?: DetectedIdentity };
type DetectedIdentity = { id: string; username?: string; email?: string };
```

- `developer` is the person who ran the tests. In CI, it is the person who
  triggered the run, from the CI provider, and no git command runs. Outside
  CI, it is `git config user.email` / `user.name`, else the OS username. The
  commit history is never read.
- The reporter detects the developer once per run, on the first failure. It
  calls the callback for each failure, with the detection and the failure
  context, so the choice can depend on the Vitest project or the test file.
- The `id` is a pseudonym: `dev-` and the first 16 hex characters of a SHA-256
  digest. The seed is the email, else the username, else the CI account id,
  trimmed and lowercased. The raw account id never reaches the callback.
- The default is `({ developer }) => developer && { id: developer.id }`. Sentry
  receives no name and no email. It receives one pseudonymous id, which is
  personal data.
- The callback returns the Sentry user. Each field that it returns reaches
  Sentry, so the personal data in the payload is exactly what the config
  writes.
- `false` skips the detection, the Sentry user and the `triggered_by` tag.
- A callback that throws, or that returns a value that is not a Sentry user,
  sends the failure with no user and logs one warning. A value that is not a
  function and not `false` falls back to the default.
- A leftover 1.5.0 `identity` or `getUser` key has no effect, and the reporter
  logs one warning for it.
- Automation bots and AI agents are excluded: `developer` is absent for them.
- The GitHub Actions provider attaches `GITHUB_ACTOR_ID` only when the
  trigger-er is `GITHUB_ACTOR`. On a re-run by another person, the id belongs
  to the original actor.

## Consequences

- A new user gets a count of the developers that each failure blocks, with
  zero configuration.
- The default sends pseudonymous personal data. A privacy review is still
  necessary before the upgrade, because the default makes that decision for
  every consumer.
- The release notes must say that 2.0 sends a Sentry user by default, and that
  outside CI it runs `git config` on the first failure. By default, 1.5.0 sent
  no user and ran no git command.
- The result does not depend on the checkout depth, on merge commits, or on
  bot and AI commit authors.
- One concept replaces five options. Each mix of detail and scope is one line,
  for example the pseudonym and the name of the developer.
- The id counts git identities and CI accounts, not people. On GitHub Actions
  the trigger-er has no email, so the CI id of a developer is seeded by the
  login and differs from the local id. A developer with two email addresses
  gets two ids. A filter on the Sentry environment counts each context on its
  own.
- A CI that exposes no trigger-er, for example a bare `CI=true`, gives no
  developer.
- The id is pseudonymous and not anonymous. The digest is unsalted, so a party
  who holds the list of team emails or logins can match an id to a person.
  That property is deliberate, because it lets a maintainer map an id back
  offline. Treat the id as personal data under the GDPR.
- The change breaks the 1.5.0 API. `identity`, `includeEmail`, `hash`, `source`
  and `getUser` no longer exist, and `detectIdentity` becomes
  `detectIdentities`. The default changes from "no user" to "pseudonym of the
  developer". The release is a major version.

## Alternatives considered

- **Keep the 1.5.0 flags.** Rejected for the problems in the context.
- **One ordered level, `'pseudonym' | 'username' | 'email'`, plus `source`.**
  This shape was the first draft of this decision. Rejected, because two enums
  fix the choices in advance, and the reader still learns two axes. One
  callback covers both axes and keeps a safe default.
- **The commit author as the default.** This shape was the second draft.
  Rejected after review, for four reasons:
  - It measures who wrote the code, not who is blocked.
  - It depends on the checkout depth. On a pull request merge ref,
    `git log -1 --no-merges` returns the synthetic merge commit in a shallow
    clone, the `actions/checkout` default, and the head commit in a full clone.
  - Bot and AI authors come back through git. In the last 20 non-merge commits
    on `main`, 8 were by `github-actions[bot]` and 4 by `dependabot[bot]`. All
    commits by an AI agent share one email, whatever human drove the agent.
  - On a local run, the last commit can belong to another developer, for
    example right after a pull.
- **Keep the commit author as a second candidate, with `HEAD^2` on a merge
  commit and a list of bot emails.** Rejected. `HEAD^2` is the pull request
  head on a CI merge ref, but on a local `git merge main` it is the base
  branch. In a depth-1 clone the parents are absent, so `HEAD^2` does not
  resolve. A list of bot emails needs maintenance. The candidate answers a
  question that the metric does not ask.
- **Keep `getUser` next to `identify`.** Rejected. Two callbacks return the
  same user with a precedence rule. The failure context, which was the reason
  for `getUser`, is now the second argument of `identify`.
- **Keep `source` next to the callback.** Rejected. The detection is fixed by
  the context, and the callback picks the fields.
- **Seed by the CI account id before the username.** Rejected. GitHub exposes
  the id of `GITHUB_ACTOR` only. On a re-run by another person the trigger-er
  has no id, so an id-first seed gives one account two pseudonyms.
- **Fall back to the git user or the OS user in a CI without a trigger-er.**
  Rejected. On a CI machine, these belong to a service account or a bot.
- **Pass the raw account id to the callback.** Rejected. An `id` that is always
  a pseudonym makes `{ id }` free of names and emails by construction.
- **Keep the feature off by default.** Rejected. An off-by-default metric stays
  empty. The cost is the privacy review above, and the release notes call it
  out.
- **Salt the digest per project.** Rejected. A salt breaks the offline mapping,
  changes every id when it rotates, and adds a knob.
- **Send a random id per run.** Rejected. The count equals the number of runs,
  not the number of developers.
- **Send the full 64-character digest.** Rejected. 64 bits do not collide at
  team scale, and the short id stays readable in the Sentry interface.

## Tests

`src/identity.test.ts` covers the CI trigger-er, the git user, the OS user
fallback, a CI without a trigger-er, the seed order, one pseudonym for one
GitHub account with and without its account id, the stability of the id across
case and whitespace, the bot and AI exclusion, and the case where nothing
resolves. `src/identity.git.test.ts` runs a real git on a pull request merge
ref with a bot commit and an AI commit, cloned shallow and in full, and checks
that both clones give the same developer. `src/reporter.test.ts` covers the
default, the callback arguments, a different user per failure, `false`, a
value that is not a function, an empty return, a wrong return shape, a
callback that throws, the leftover 1.5.0 keys, the manual `triggered_by` tag,
and the single detection per run. `src/ci-providers/github.test.ts` covers the
id pairing on a re-run.

## References

- [ADR 0008](0008-resolve-codeowners-into-sentry-tags.md) for the other
  attribution signal.
- [Sentry user documentation](https://docs.sentry.io/platforms/javascript/enriching-events/identify-user/)
- GDPR [Article 4(5)](https://gdpr-info.eu/art-4-gdpr/) and
  [Recital 26](https://gdpr-info.eu/recitals/no-26/): pseudonymised data is
  personal data.

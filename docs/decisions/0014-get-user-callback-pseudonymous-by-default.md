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
people after the failure context. The name and the first argument match
`getTags` and `getFingerprint`. A 1.5.0 `getUser(ctx)` callback works without a
change.

```ts
getUser?:
  | ((ctx: FailureContext, detected: DetectedIdentities) => SentryUser | undefined)
  | false;

type DetectedIdentities = { developer?: DetectedIdentity; committer?: DetectedIdentity };
type DetectedIdentity = { id?: string; username?: string; email?: string; pseudonymizedId: string };
```

- `developer` is the person who ran the tests. In CI, it is the account that
  triggered the run, from the CI provider. Outside CI, it is
  `git config user.*`, else the OS username. It is absent when a bot or an AI
  agent runs the tests.
- `committer` is the person behind the latest commit: the committer of `HEAD`,
  else its author. GitHub (`noreply@github.com`) and `*[bot]` accounts do not
  count. The agents of `ACTOR_DETECTORS` do not count either: each entry
  carries the email that the agent commits with, so a new agent is one entry.
  `HEAD` carries its own metadata, so the result does not depend on the
  checkout depth.
- Each candidate keeps the `id`, `username` and `email` that the source
  exposes. `pseudonymizedId` is `dev-` and 16 hex characters of the SHA-256
  digest of the email, else the username, else the account id, trimmed and
  lowercased.
- The default sends `{ id: pseudonymizedId }` of `developer`, else of
  `committer`. A run that a bot triggers, for example a merge queue, then
  counts the person behind the change, if `HEAD` has a committer or an author
  that is not GitHub, a bot or an AI agent. Else the default sends no user.
- The reporter makes the detection once per run, on the first failure. It
  calls the callback for each failure, with the failure context and the
  detection. Each person resolves on its first read only, with its git
  command, so a callback that reads no person runs no git command. The default
  reads `committer` only when there is no developer. An assignment replaces a
  person and runs no detection.
- A `user_source` tag, `developer` or `committer`, tells which person the
  Sentry user stands for. The reporter compares the returned fields with the
  people that the callback read, so the tag also works for a custom callback,
  and it never runs git.
- `false` skips the detection, the Sentry user, and the `triggered_by` and
  `user_source` tags. A callback that throws, or that returns a truthy value
  that is not a Sentry user, sends the failure with no user and logs one
  warning. A leftover 1.5.0 `identity` key logs one warning.
- The GitHub Actions provider reads `GITHUB_TRIGGERING_ACTOR`, else
  `GITHUB_ACTOR`, so a re-run counts the person who started it. It attaches
  `GITHUB_ACTOR_ID` only when both name one account, because GitHub exposes no
  id for the triggering actor. GitHub exposes no email either, so the seed of
  the pseudonymized id is the username, with or without the id. The actor
  check reads the same account, so a person who re-runs the job of a bot is a
  human, and counts as the developer.

## Consequences

- A new user gets a count of the developers that each failure affects, with
  zero configuration.
- The default sends pseudonymous personal data. A privacy review is still
  necessary before the upgrade, because the default makes that decision for
  every consumer.
- The release notes must say that 2.0 sends a Sentry user by default. With
  the default callback, on the first failure, the reporter runs `git config`
  outside CI, and `git log -1` when it finds no developer. By default, 1.5.0
  sent no user and ran no git command.
- On a GitHub re-run, `actor_type` and `actor_name` describe the account that
  started the re-run, and no longer the account that started the first run.
- `triggered_by` carries the committer when the default falls back to it. The
  `user_source` tag tells this case apart.
- On a scheduled GitHub run, `developer` is the person who last changed the
  `cron` schedule or the default branch, because GitHub makes that person the
  actor of the run.
- A developer and a committer with one email get one pseudonymized id.
- One person can get two ids: a GitHub login in CI and a git email locally, or
  two emails. A filter on the Sentry environment counts each context on its
  own.
- The callback receives the raw fields. A function that returns them sends
  them, for example the public GitHub account id. Sentry counts a user by
  `id`, else `username`, else `email`, so raw fields can count one person
  twice: a GitHub run has an `id`, and a local run has none.
- A read of a person can be implicit: destructuring, a spread or
  `JSON.stringify`. A callback that destructures both people always runs
  `git log -1`.
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
- **`GITHUB_ACTOR` with `GITHUB_ACTOR_ID`, always.** A draft of this decision.
  Rejected in review. A re-run then counts the person who started the first
  run, and not the person that the failure blocks. The id no longer feeds the
  pseudonymized id, so the pairing gave nothing in return.
- **A separate `identify` callback next to `getUser`.** A draft of this
  decision. Rejected. Two callbacks return the same user with a precedence
  rule.
- **`getUser(detected, ctx)`, with the detection first.** A draft of this
  decision. Rejected in review. In a JavaScript config, a 1.5.0
  `getUser(ctx)` callback then gets the detection in place of the failure
  context, and fails with no signal.
- **A separate list of automation emails next to `ACTOR_DETECTORS`.** A draft
  of this decision. Rejected in review. A new agent then needs two edits in two
  files.
- **An actor check on `GITHUB_ACTOR` only.** A draft of this decision.
  Rejected in review. A person who re-runs the job of a bot then gets no user.
- **No actor check in CI, only the automation check of the trigger-er.**
  Rejected. The `actor_type` tag would still say `bot` for a run that a person
  started.
- **A detection that runs `git` at once.** A draft of this decision. Rejected
  in review. A callback that reads no person, and the `user_source` tag, then
  run git for nothing.
- **Keep the feature off by default.** Rejected. An off-by-default metric stays
  empty.
- **Salt the digest, send a random id per run, or send the full digest.**
  Rejected. A salt breaks the offline mapping. A random id counts runs, not
  developers. 64 bits do not collide at team scale.

## Tests

`src/identity.test.ts` covers the seed order and its normalization, the raw
fields, one id for a developer and a committer with one email, the CI
trigger-er, a CI without a trigger-er, the git user, the OS user fallback, the
committer and its author fallback, no detection before the first read, a single
`git log` on the first read, an assignment with no detection, the exclusion of
GitHub, bots and the agents of the registry, and the case where nothing
resolves. `src/identity.ci.test.ts` runs the real actor registry and GitHub
provider: a person who re-runs the job of a bot counts, and a bot that runs or
re-runs a job does not. `src/identity.git.test.ts` runs a real git on a pull
request merge ref, cloned shallow and in full. It checks that both clones give
the same developer and the same committer, and that a bot at `HEAD` gives no
committer. `src/reporter.test.ts` covers the default and its committer fallback,
the `user_source` tag, no read of `committer` when the default has a developer,
the callback arguments, a 1.5.0 `getUser(ctx)` callback that reads no person, a
different user per failure, `false`, the wrong return shapes, a callback that
throws, the leftover 1.5.0 keys, the manual `triggered_by` and `user_source`
tags, and the single detection per run. `src/ci-providers/github.test.ts` covers
the triggering actor, and the id only for one account.
`src/actor-detectors/index.test.ts` covers the login of a GitHub re-run.

## References

- [ADR 0008](0008-resolve-codeowners-into-sentry-tags.md) for the other
  attribution signal.
- [Sentry user documentation](https://docs.sentry.io/platforms/javascript/enriching-events/identify-user/)
- [GitHub Actions variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables):
  `GITHUB_TRIGGERING_ACTOR` has no id, and `GITHUB_ACTOR_ID` is the id of the
  account that started the first run.
- `EventUser.tag_value` in
  [getsentry/sentry `src/sentry/utils/eventuser.py`](https://github.com/getsentry/sentry/blob/master/src/sentry/utils/eventuser.py):
  how Sentry counts distinct users.
- GDPR [Article 4(5)](https://gdpr-info.eu/art-4-gdpr/) and
  [Recital 26](https://gdpr-info.eu/recitals/no-26/): pseudonymised data is
  personal data.

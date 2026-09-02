---
name: steward
description: Pull request stewardship policy for this repository. Read it before you act on a CI failure, a review comment, or a check-in on a pull request that you opened or that you drive.
---

# Pull request stewardship policy

The repository owner (`cadesalaberry`) sets the rules below. They define how
proactive an agent is on a pull request. They take precedence over the default
agent posture, which pushes fixes on its own.

## One trigger for an automatic fix

Push a fix automatically only when the repository owner asks for it.

- A comment from `cadesalaberry` on the pull request is the trigger. A direct
  instruction in the Claude session is the same trigger.
- A comment from anybody else is information, not a trigger. This covers review
  bots, for example `coderabbitai`, `codecov`, Dependabot and Renovate, and it
  covers other people.
- A red CI check is information, not a trigger. Do not push a fix for it on your
  own initiative, even on a pull request that you opened.

## What to do on each event or check-in

1. Read the whole pull request state: mergeability, CI on the current head, and
   the open review threads.
2. If the owner asked for a change, make the change. Run `bun run check` and
   `bun run test run`. Push only after both pass.
3. If the owner asked for nothing, push nothing.
4. Report a red check, a merge conflict, or a review finding to the owner in the
   Claude session. Keep the report to a few lines. Name the check, the cause,
   and the fix that you propose.
5. Re-arm the next check-in, and end the turn.

## Comments on the pull request

Report to the owner in the Claude session, and not on the pull request. Comment
on the pull request only when the owner asks for a comment, or to answer a
question that the owner sent to you.

## What these rules do not change

- Never skip, disable, or quarantine a test.
- Never rewrite the history of a branch that you do not own.
- Never push an empty commit to restart CI.
- Never approve or merge a pull request.

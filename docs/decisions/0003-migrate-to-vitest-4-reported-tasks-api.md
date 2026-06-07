# Migrate the reporter to the Vitest 4 reported-tasks API

- Status: accepted
- Date: 2026-06-07

## Context

The reporter was written against the pre-Vitest-4 task-based reporter API. On
Vitest 4 it still ran without crashing, but it produced corrupt events:

- `onTaskUpdate(packs)` — Vitest 4 keeps dispatching this *deprecated* hook, but
  with the legacy pack shape `[id, result, meta]`. The code read `pack[0]` as a
  *task object* when it is actually an **id string**, so every event got
  `test_name: 'unknown'` and a `Math.random()` id. Dedup keyed on that id never
  matched, so a single failure was reported multiple times.
- `onTestRunEnd(testModules)` — the hook name was correct, but the body iterated
  `file.tasks` (the old `File` shape). Vitest 4 passes `TestModule[]` with no
  `.tasks`, so the end-of-run sweep collected nothing.
- State checks compared against `'fail'`, but Vitest 4 uses `'failed'`, and
  `types.ts` carried a whole hand-rolled legacy type layer shadowing the real
  Vitest types.

A first migration attempt landed in #1, was reverted in #2, and is re-landed
here in #3.

## Decision

Rewrite the reporter onto Vitest 4's public **reported-tasks** reporter API
(`vitest/node`) and remove the legacy code paths.

- **`src/reporter.ts`** — drop `onTaskUpdate`; the class now `implements Reporter`
  from `vitest/node` and uses:
  - `onTestCaseResult(testCase)` for incremental collection of failures as they
    happen;
  - `onTestRunEnd(testModules, …)` iterating `TestModule.children.allTests('failed')`
    as a defensive final sweep, then flushing;
  - `onUserConsoleLog(log)` to buffer per-test console output (keyed by `taskId`)
    so it can be attached to the failure event, preserving the documented `logs`
    extra.
  - A shared `collectFailure` dedup helper keyed on `testCase.id`, and
    `maxEventsPerRun` now counts events actually sent rather than ids seen.
- **`src/utils.ts`** — `toFailureContext` consumes a `TestCase`
  (`.result()`, `.diagnostic()`, `.module.moduleId`, `.fullName`);
  `collectSuitePath` walks the `TestCase.parent` chain (ending at the module).
  Removed the now-unused `buildFullTitle` and `extractLogs` helpers.
- **`src/types.ts`** — delete the legacy type layer (`VitestTaskLike`,
  `VitestTaskResult`, `VitestSuiteNode`, `TaskUpdatePack`, the stale
  `declare class`); add a minimal `VitestUserConsoleLog` covering only the fields
  the reporter reads.
- **Tests** — rewrite `utils.test.ts` against the `TestCase` API, add
  `reporter.test.ts` (dedup, end-of-run sweep, `maxEventsPerRun`, `shouldReport`,
  log buffering, no-DSN path), and fix a pre-existing wrong assertion in
  `dry-run-transport.test.ts`.
- **`package.json` / `README.md`** — bump the `vitest` peer dependency from
  `>=1.0.0` to `>=4.0.0` and update the README compatibility note to "Vitest 4+".
- Clean up two leftover debug hacks in `initSentry`: `debug: true || isDryRun`
  becomes `debug: isDryRun`, and the DSN `console.log` is gated behind dry-run.

## Consequences

- **Breaking change.** Vitest < 4 is no longer supported (peer dependency
  `>=4.0.0`). This warrants a major version bump for the package.
- Events are now correct on Vitest 4: real `test_name`, `test_full_title`
  (`suite > test`), `test_file`, `flaky`, `retry`, and `extras`
  (`suite_path`, `duration_ms`, `vitest_version`). End-to-end verification
  showed exactly one event per run (`count: 2` across two runs), confirming
  dedup works.
- The reporter now depends on the **public** `vitest/node` reporter contract
  rather than reverse-engineered internal task shapes, so it is less fragile and
  easier to keep in step with future Vitest releases.
- Consumers still on Vitest 2/3 must either pin an older release of this package
  or upgrade Vitest.

## Alternatives

- **Keep dual code paths for both the legacy task API and the reported-tasks
  API.** Rejected: the deprecated `onTaskUpdate` pack shape on Vitest 4 differs
  from the pre-4 shape, so a compatibility shim would be complex and fragile for
  diminishing benefit as Vitest 2/3 fade out.
- **Stay on the deprecated `onTaskUpdate` hook and just fix the pack parsing.**
  Rejected: the hook is deprecated and slated for removal, and it does not give
  clean access to the new `TestCase` result/diagnostic data the reporter needs.

## References

- PR #3: https://github.com/cadesalaberry/vitest-sentry-reporter/pull/3
- Superseded earlier attempts: PR #1 (reverted by PR #2)
- Vitest reporters: https://vitest.dev/guide/reporters.html
- Vitest advanced reporter / reported tasks API: https://vitest.dev/advanced/api/reporters.html

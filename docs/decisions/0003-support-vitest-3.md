---
title: Support Vitest 3 by relaxing the peer dependency range
date: 2026-06-07
status: accepted
---

Context
 - The reporter declared `peerDependencies.vitest: ">=4.0.0"`, which blocked installation on Vitest 3 projects.
 - The reporter is built on the "reported-tasks" reporter API (`onTestCaseResult`, `onTestRunEnd`, and the `TestCase` / `TestModule` / `TestSuite` objects from `vitest/node`). That API was introduced in Vitest `3.0.0`; the API that was removed in Vitest 4 is the older one (`onTaskUpdate`, `onFinished`, `onCollected`), which this reporter never used.
 - Every method and property the reporter touches — `testCase.result()`, `testCase.diagnostic()` (`duration`/`retryCount`/`flaky`), `testCase.fullName`, `testCase.module.moduleId`, `testCase.parent`, `testCase.project.name`, and `testModule.children.allTests('failed')` — exists with identical signatures in Vitest `3.0.0`. No source changes are needed for compatibility.

Decision
 - Relax `peerDependencies.vitest` from `">=4.0.0"` to `">=3.0.0"`.
 - Keep `devDependencies.vitest` on the latest major (`^4.0.13`) so development and type-checking happen against the newest API surface.
 - Add a CI matrix that builds and runs the test suite against both Vitest 3 and Vitest 4 so the compatibility claim is verified on every push and cannot silently regress.
 - Do not lower support below `3.0.0`: the `onTestCaseResult` / `onTestRunEnd` lifecycle did not exist in 2.x (only the experimental reported-tasks objects did).

Consequences
 - Vitest 3 users can install and use the reporter.
 - The `build` step (`tsc --emitDeclarationOnly`) type-checks `src/` against the installed Vitest types, so a green matrix leg doubles as a type-compatibility check for that major.
 - The CI matrix doubles the job count for this workflow.

Verification
 - Type-check (`bun run build`) and the unit suite (`bun run test run`) pass against `vitest@3.0.0` and `vitest@3.2.6`.
 - An end-to-end dry-run against real `vitest@3.0.0` objects (a deliberately failing test reported through the reporter in `dryRun` mode) produced the expected Sentry envelope with correct `test_file`, `test_name`, and `test_full_title` tags.

References
 - Vitest 4 migration guide: reporter APIs `onCollected`, `onTaskUpdate`, `onFinished` removed; "The new APIs were introduced in Vitest `v3.0.0`."
 - ADR 0002 (dry-run transport), reused for the end-to-end verification above.

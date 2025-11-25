---
title: Add dry-run transport to log Sentry envelopes instead of sending
date: 2025-09-04
status: accepted
---

Context
 - We want a way to validate what would be reported to Sentry without actually sending events (useful locally or in CI dry runs).
 - The reporter already had a `dryRun` flag that short-circuited reporting. This prevented exercising Sentry scope logic, event processors, and grouping.

Decision
 - Implement a custom Sentry transport factory that logs envelope items (type + payload) and returns a resolved promise.
 - Enable this transport when `dryRun` is true via `Sentry.init({ transport: makeDryRunTransport })`.
 - Allow an inert DSN in dry-run mode to initialize the SDK and run the normal capture flow.
 - Move the transport to `src/dry-run-transport.ts` and keep `src/reporter.ts` focused on reporter behavior.

Details
 - `makeDryRunTransport` implements `{ send(envelope), flush(timeout) }`.
 - `send` iterates `envelope[1]` items and logs `{ type, payload }` with a clear prefix.
 - Minimal internal `Envelope` typings are defined locally to avoid importing Sentry private types.
 - `reportFailure` no longer short-circuits on `dryRun`; events go through scopes, tags, and `beforeSend` processors.
 - `initSentry` chooses a fallback DSN when `dryRun` is enabled and sets the transport accordingly.

Consequences
 - Local and CI dry runs show deterministic logs of would-be sent payloads.
 - The same code paths are exercised in both dry-run and real modes, reducing drift and surprises.
 - No network traffic is emitted during dry runs.

Alternatives considered
 - Keep early-return logging in the reporter: rejected, because it bypassed Sentry’s scope/event pipeline and diverged from real behavior.
 - Mock Sentry client entirely: rejected, higher maintenance and more divergence from SDK behavior.

Tests
 - Added `src/dry-run-transport.test.ts` to assert logging behavior and `flush` returning `true`.




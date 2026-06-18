import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TestCase, TestModule, TestSuite } from 'vitest/node';
import { detectActor } from './actor-detectors/index.js';
import { detectProvider } from './ci-providers/index.js';
import type { FailureContext, Primitive } from './types.js';

/** Marker to manually pin the reported `trigger` tag (e.g. `ci`, `manual`, `cron`). */
export const TRIGGER_ENV = 'VITEST_SENTRY_TRIGGER';

/**
 * Detected tags whose values yield to the same keys manually specified via the
 * reporter's `tags`/`getTags` options.
 */
export const MANUALLY_OVERRIDABLE_TAGS = [
  'trigger',
  'actor_type',
  'actor_name',
  'code_owners',
  'code_owner',
] as const;

export function toErrorMessage(err: unknown): string | undefined {
  if (!err) return undefined;
  if (typeof err === 'string') return err;
  const e = err as { message?: unknown; name?: unknown };
  return String(e.message ?? e.name ?? 'Error');
}

export function toStack(err: unknown): string | undefined {
  if (!err) return undefined;
  const maybe = err as { stack?: string };
  return typeof maybe.stack === 'string' ? maybe.stack : undefined;
}

/**
 * Walk a test case's parent chain, collecting the enclosing suite names
 * (outermost first). The chain ends at the test module, which is not a suite.
 */
export function collectSuitePath(testCase: TestCase): string[] {
  const names: string[] = [];
  let cur: TestSuite | TestModule = testCase.parent;
  while (cur.type === 'suite') {
    names.unshift(cur.name);
    cur = cur.parent;
  }
  return names;
}

/**
 * Convert a finished Vitest {@link TestCase} into the reporter's
 * {@link FailureContext}. `logs` are collected separately via the
 * `onUserConsoleLog` reporter hook and threaded in by the caller.
 */
export function toFailureContext(
  testCase: TestCase,
  logs?: string[],
): FailureContext {
  const result = testCase.result();
  const diagnostic = testCase.diagnostic();
  const firstErr = result.errors?.[0];
  const suitePath = collectSuitePath(testCase);

  return {
    id: testCase.id,
    filePath: testCase.module.moduleId,
    testName: testCase.name,
    fullTitle: testCase.fullName,
    suitePath,
    message: toErrorMessage(firstErr),
    stack: toStack(firstErr),
    error: firstErr,
    // Vitest reports high-resolution fractional durations; Sentry expects
    // whole milliseconds, so round to the nearest integer.
    durationMs:
      diagnostic?.duration == null
        ? undefined
        : Math.round(diagnostic.duration),
    retry: diagnostic?.retryCount,
    flaky: Boolean(diagnostic?.flaky),
    logs,
    meta: { testId: testCase.id, projectName: testCase.project.name },
  };
}

export function ciProvider(): string | undefined {
  return (
    detectProvider(process.env)?.name ?? (process.env.CI ? 'ci' : undefined)
  );
}

export function repository(): string | undefined {
  const p = detectProvider(process.env);
  return p?.repository(process.env);
}

export function branch(): string | undefined {
  const p = detectProvider(process.env);
  return p?.branch(process.env);
}

export function commitSha(): string | undefined {
  const p = detectProvider(process.env);
  return p?.commitSha(process.env);
}

/**
 * URL of the CI run/build that produced the failure (e.g. the CircleCI build
 * page, the GitHub Actions run). Undefined when no CI provider is detected or
 * the provider does not expose one.
 */
export function runUrl(): string | undefined {
  const p = detectProvider(process.env);
  return p?.runUrl(process.env);
}

export function workflowId(): string | undefined {
  const p = detectProvider(process.env);
  return p?.workflowId(process.env);
}

/**
 * Best-effort absolute path to the repository root, used to locate a
 * CODEOWNERS file and relativize test paths. Prefers the active CI provider's
 * checkout path (expanding a leading `~`), falling back to `process.cwd()`
 * whenever the provider path is absent or does not exist on disk.
 */
export function repoRoot(): string | undefined {
  const candidate = detectProvider(process.env)?.rootPath(process.env);
  if (candidate) {
    const expanded = candidate.startsWith('~')
      ? path.join(os.homedir(), candidate.slice(1))
      : candidate;
    if (fs.existsSync(expanded)) return expanded;
  }
  return process.cwd();
}

export function inferEnvironment(): string | undefined {
  if (ciProvider()) return 'ci';
  return process.env.NODE_ENV || 'local';
}

/**
 * How the test run was started: `ci` when a CI provider is detected, otherwise
 * `manual`. Set the {@link TRIGGER_ENV} marker to override the detection.
 */
export function detectTrigger(env: NodeJS.ProcessEnv = process.env): string {
  const manual = env[TRIGGER_ENV]?.trim();
  if (manual) return manual;
  return detectProvider(env) || env.CI ? 'ci' : 'manual';
}

export function vitestVersion(): string | undefined {
  try {
    const req = createRequire(import.meta.url);
    const v = req('vitest/package.json') as { version?: string };
    return v?.version;
  } catch {
    return undefined;
  }
}

function providerEnvSnapshot(): Record<string, string | undefined> {
  const p = detectProvider(process.env);
  if (p?.envSnapshot) return p.envSnapshot(process.env);
  return process.env.CI ? { CI: process.env.CI } : {};
}

export function cleanRecord(
  obj?: Record<string, unknown>,
): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = typeof v === 'object' ? JSON.stringify(v) : (v as Primitive);
  }
  return out;
}

export function baseTags(ctx: FailureContext): Record<string, Primitive> {
  const actor = detectActor(process.env);
  return {
    reporter: 'vitest-sentry-reporter',
    test_file: ctx.filePath ?? 'unknown',
    test_name: ctx.testName,
    test_full_title: ctx.fullTitle ?? ctx.testName,
    flaky: String(Boolean(ctx.flaky)),
    retry: ctx.retry ?? 0,
    node_version: process.version,
    os_platform: os.platform(),
    os_release: os.release(),
    ci: ciProvider() ?? 'local',
    trigger: detectTrigger(process.env),
    actor_type: actor.type,
    actor_name: actor.name,
    repository: repository() ?? undefined,
    branch: branch() ?? undefined,
    commit_sha: commitSha() ?? undefined,
    run_url: runUrl() ?? undefined,
  };
}

/**
 * Structured CI run context. Sentry renders URL values in the contexts panel
 * as clickable links, so the failing run (e.g. the CircleCI build) is one
 * click away from the Sentry issue. Returns an empty object when no CI
 * provider is detected, in which case the caller should skip setting it.
 */
export function ciContext(): Record<string, Primitive> {
  return cleanRecord({
    provider: ciProvider(),
    run_url: runUrl(),
    workflow_id: workflowId(),
  });
}

export function extras(ctx: FailureContext): Record<string, unknown> {
  return {
    duration_ms: ctx.durationMs,
    logs: ctx.logs,
    suite_path: ctx.suitePath,
    vitest_version: vitestVersion(),
    env: providerEnvSnapshot(),
  };
}

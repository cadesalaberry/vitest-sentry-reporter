import { createRequire } from 'node:module';
import * as os from 'node:os';
import type { TestCase, TestModule, TestSuite } from 'vitest/node';
import { detectProvider } from './ci-providers/index.js';
import type { FailureContext, Primitive } from './types.js';

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
    durationMs: diagnostic?.duration,
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

export function inferEnvironment(): string | undefined {
  if (ciProvider()) return 'ci';
  return process.env.NODE_ENV || 'local';
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
    repository: repository() ?? undefined,
    branch: branch() ?? undefined,
    commit_sha: commitSha() ?? undefined,
  };
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

import * as os from 'os';
import { createRequire } from 'module';
import type { Primitive, VitestTaskLike, VitestTaskResult, FailureContext, VitestErrorLike, VitestSuiteNode } from './index.';
import { detectProvider } from './ci-providers';

export function toErrorMessage(err: unknown): string | undefined {
  if (!err) return undefined;
  if (typeof err === 'string') return err;
  const e = err as Partial<VitestErrorLike> | Error;
  return String((e as Error).message ?? (e as VitestErrorLike).name ?? 'Error');
}

export function toStack(err: unknown): string | undefined {
  if (!err) return undefined;
  const maybe = err as { stack?: string };
  return typeof maybe.stack === 'string' ? maybe.stack : undefined;
}

export function collectSuitePath(task: VitestTaskLike): string[] {
  const names: string[] = [];
  let cur: VitestSuiteNode | undefined = task.suite ?? task.parent;
  while (cur) {
    if (cur.name) names.unshift(String(cur.name));
    cur = cur.suite ?? cur.parent;
  }
  return names;
}

export function buildFullTitle(suitePath: string[] | undefined, testName: string): string | undefined {
  if (!suitePath?.length) return testName;
  return `${suitePath.join(' > ')} > ${testName}`;
}

export function extractLogs(task: VitestTaskLike): string[] | undefined {
  const logs = task.result?.logs ?? task.logs;
  if (!Array.isArray(logs)) return undefined;
  return logs.map((l) => (typeof l === 'string' ? l : String((l as unknown as { message?: string; text?: string }).message ?? (l as unknown as { message?: string; text?: string }).text ?? l)));
}

export function toFailureContext(task: VitestTaskLike, result?: VitestTaskResult): FailureContext {
  const failures = result?.errors ?? task.errors ?? [];
  const firstErr = failures[0];
  const testName = String(task.name ?? task.fullName ?? 'unknown');
  const filePath = task.file?.filepath ?? task.file?.name ?? task.location?.file;
  const suitePath = Array.isArray(task.suitePath) ? task.suitePath : (task.suite ? collectSuitePath(task) : undefined);

  const message = toErrorMessage(firstErr);
  const stack = toStack(firstErr);
  const durationMs = result?.duration ?? task.duration;
  const retry = result?.retry ?? task.retry;
  const flaky = Boolean(result?.flaky ?? task.meta?.flaky);
  const logs = extractLogs(task);

  return {
    id: String(task.id ?? task.name ?? filePath ?? Math.random()),
    filePath,
    testName,
    fullTitle: buildFullTitle(suitePath, testName),
    suitePath,
    message,
    stack,
    error: firstErr,
    durationMs,
    retry,
    flaky,
    logs,
    meta: { rawTask: task, rawResult: result },
  };
}

export function ciProvider(): string | undefined {
  return detectProvider(process.env)?.name ?? (process.env.CI ? 'ci' : undefined);
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

export function cleanRecord(obj?: Record<string, unknown>): Record<string, Primitive> {
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



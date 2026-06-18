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
  const filePath = testCase.module.moduleId;

  return {
    id: testCase.id,
    filePath,
    relativeFilePath: relativeTestFile(filePath),
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

/**
 * Convert an absolute test file path to a repository-root-relative POSIX path,
 * so the same failure groups identically across local and CI checkouts (whose
 * absolute paths differ). Returns the original path when there is no root or
 * the file lives outside it.
 */
export function relativeTestFile(
  filePath: string | undefined,
  root: string | undefined = repoRoot(),
): string | undefined {
  if (!filePath || !root) return filePath;
  const rel = path.relative(root, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return filePath;
  // Normalize to POSIX separators so fingerprints match across platforms.
  return rel.split(path.sep).join('/');
}

/**
 * Name of the current CI job, step or shard (e.g. GitHub job id, GitLab/CircleCI
 * job name, Buildkite step label), or `undefined` outside a recognized CI.
 */
export function jobName(): string | undefined {
  return detectProvider(process.env)?.jobName?.(process.env);
}

/**
 * Direct, clickable CI links for the current run — pull/merge request, the run
 * itself, and the commit under test — for triage. Only defined links are
 * included; returns an empty object outside a recognized CI provider.
 */
export function ciContext(): Record<string, string> {
  const p = detectProvider(process.env);
  if (!p) return {};
  const links: Record<string, string | undefined> = {
    pull_request_url: p.pullRequestUrl?.(process.env),
    run_url: p.runUrl?.(process.env),
    commit_url: p.commitUrl?.(process.env),
    workflow_id: p.workflowId?.(process.env),
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(links)) if (v) out[k] = v;
  return out;
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
  const projectName =
    typeof ctx.meta?.projectName === 'string'
      ? ctx.meta.projectName
      : undefined;
  return {
    reporter: 'vitest-sentry-reporter',
    test_file: ctx.relativeFilePath ?? ctx.filePath ?? 'unknown',
    test_name: ctx.testName,
    test_full_title: ctx.fullTitle ?? ctx.testName,
    // Vitest project/workspace name; useful for triage in monorepos.
    test_project: projectName || undefined,
    flaky: String(Boolean(ctx.flaky)),
    retry: ctx.retry ?? 0,
    node_version: process.version,
    os_platform: os.platform(),
    os_release: os.release(),
    ci: ciProvider() ?? 'local',
    trigger: detectTrigger(process.env),
    actor_type: actor.type,
    actor_name: actor.name,
    job_name: jobName() ?? undefined,
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

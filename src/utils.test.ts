import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock CI provider and OS to keep tests deterministic
vi.mock('./ci-providers/index.js', () => {
  return { detectProvider: vi.fn() };
});

vi.mock('os', () => {
  return {
    platform: () => 'darwin',
    release: () => '24.0.0',
  };
});

import {
  toErrorMessage,
  toStack,
  collectSuitePath,
  buildFullTitle,
  extractLogs,
  toFailureContext,
  ciProvider,
  repository,
  branch,
  commitSha,
  inferEnvironment,
  vitestVersion,
  cleanRecord,
  baseTags,
  extras,
} from './utils';

type AnyFn = (...args: unknown[]) => unknown;

async function getDetectProviderMock(): Promise<AnyFn> {
  const mod = await import('./ci-providers/index.js');
  return (mod.detectProvider as unknown as AnyFn);
}

describe('utils', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.CI;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toErrorMessage returns expected strings', () => {
    expect(toErrorMessage(undefined)).toBeUndefined();
    expect(toErrorMessage('oops')).toBe('oops');
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
    expect(toErrorMessage({ name: 'TypeError' })).toBe('TypeError');
  });

  it('toStack extracts stack string', () => {
    const e = new Error('x');
    expect(typeof toStack(e)).toBe('string');
    expect(toStack({})).toBeUndefined();
    expect(toStack(undefined)).toBeUndefined();
  });

  it('collectSuitePath walks up suite/parent chain', () => {
    const task = {
      suite: { name: 'outer', parent: { name: 'root' } },
      parent: undefined,
    } as unknown as import('./types').VitestTaskLike;
    expect(collectSuitePath(task)).toEqual(['root', 'outer']);
  });

  it('buildFullTitle joins suite path and test name', () => {
    expect(buildFullTitle(['a', 'b'], 'c')).toBe('a > b > c');
    expect(buildFullTitle(undefined, 'x')).toBe('x');
  });

  it('extractLogs normalizes different log shapes', () => {
    const task = {
      result: {
        logs: ['a', { message: 'b' } as unknown as string, { text: 'c' } as unknown as string, 42 as unknown as string],
      },
    } as unknown as import('./types').VitestTaskLike;
    expect(extractLogs(task)).toEqual(['a', 'b', 'c', '42']);
  });

  it('toFailureContext builds a rich context object', () => {
    const task = {
      id: 'id-1',
      name: 'does things',
      file: { filepath: '/tests/example.test.ts' },
      suitePath: ['suite1', 'suite2'],
      errors: [{ message: 'bad', stack: 'STACK' }],
      logs: ['l1'],
      meta: { flaky: true },
    } as unknown as import('./types').VitestTaskLike;

    const result = { duration: 123, retry: 1, flaky: true, errors: [{ message: 'bad', stack: 'STACK' }] } as import('./types').VitestTaskResult;

    const ctx = toFailureContext(task, result);
    expect(ctx).toEqual(
      expect.objectContaining({
        id: 'id-1',
        filePath: '/tests/example.test.ts',
        testName: 'does things',
        fullTitle: 'suite1 > suite2 > does things',
        suitePath: ['suite1', 'suite2'],
        message: 'bad',
        stack: 'STACK',
        durationMs: 123,
        retry: 1,
        flaky: true,
        logs: ['l1'],
      }),
    );
    expect(ctx.meta).toBeDefined();
  });

  it('cleanRecord drops nullish values and stringifies objects', () => {
    const input = { a: 1, b: null, c: undefined, d: { x: true }, e: 'ok', f: false } as Record<string, unknown>;
    const out = cleanRecord(input);
    expect(out).toEqual({ a: 1, d: JSON.stringify({ x: true }), e: 'ok', f: false });
  });

  it('ciProvider and repo info come from provider when available', async () => {
    const detect = await getDetectProviderMock();
    const provider = {
      name: 'github',
      repository: () => 'acme/widgets',
      branch: () => 'main',
      commitSha: () => 'abc123',
      envSnapshot: () => ({ CI: 'true', FOO: 'BAR' }),
    };
    (detect as any).mockReturnValue(provider);

    expect(ciProvider()).toBe('github');
    expect(repository()).toBe('acme/widgets');
    expect(branch()).toBe('main');
    expect(commitSha()).toBe('abc123');
  });

  it('ciProvider falls back to "ci" when CI env set and no provider', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue(undefined);
    process.env.CI = 'true';
    expect(ciProvider()).toBe('ci');
  });

  it('inferEnvironment returns "ci" when provider exists, else NODE_ENV or local', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({ name: 'whatever' });
    expect(inferEnvironment()).toBe('ci');

    (detect as any).mockReturnValue(undefined);
    process.env.NODE_ENV = 'test';
    expect(inferEnvironment()).toBe('test');

    delete process.env.NODE_ENV;
    expect(inferEnvironment()).toBe('local');
  });

  it('vitestVersion returns a semver-like string', () => {
    const v = vitestVersion();
    expect(typeof v === 'string' && v.length > 0).toBe(true);
  });

  it('baseTags includes platform, CI and repo fields', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({
      name: 'github',
      repository: () => 'acme/widgets',
      branch: () => 'main',
      commitSha: () => 'abc123',
    });

    const ctx = { testName: 't', filePath: '/x', fullTitle: 'full', flaky: true, retry: 2 } as import('./types').FailureContext;
    const tags = baseTags(ctx);
    expect(tags).toEqual(
      expect.objectContaining({
        reporter: 'vitest-sentry-reporter',
        test_file: '/x',
        test_name: 't',
        test_full_title: 'full',
        flaky: 'true',
        retry: 2,
        os_platform: 'darwin',
        os_release: '24.0.0',
        ci: 'github',
        repository: 'acme/widgets',
        branch: 'main',
        commit_sha: 'abc123',
      }),
    );
  });

  it('extras returns duration/logs/suite path, vitest version and env snapshot', async () => {
    const detect = await getDetectProviderMock();
    (detect as any).mockReturnValue({
      name: 'github',
      envSnapshot: () => ({ CI: 'true', GIT: '1' }),
    });

    const ctx = {
      testName: 't',
      durationMs: 50,
      logs: ['a'],
      suitePath: ['s'],
    } as import('./types').FailureContext;

    const ex = extras(ctx);
    expect(ex).toEqual(
      expect.objectContaining({
        duration_ms: 50,
        logs: ['a'],
        suite_path: ['s'],
      }),
    );
    expect(typeof (ex as any).vitest_version === 'string' || (ex as any).vitest_version === undefined).toBe(true);
    expect((ex as any).env).toEqual({ CI: 'true', GIT: '1' });
  });
});




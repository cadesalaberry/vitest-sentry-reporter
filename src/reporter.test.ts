import type { Event } from '@sentry/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestCase, TestModule } from 'vitest/node';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  captureException: vi.fn(),
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({
      setTags: vi.fn(),
      setExtras: vi.fn(),
      setExtra: vi.fn(),
      setContext: vi.fn(),
      setFingerprint: vi.fn(),
      setUser: vi.fn(),
      addEventProcessor: vi.fn(),
    }),
  ),
}));

vi.mock('@sentry/node', () => sentry);

// Keep CI/provider detection deterministic and quiet.
vi.mock('./ci-providers/index.js', () => ({
  detectProvider: vi.fn(() => undefined),
}));

import { detectProvider } from './ci-providers/index.js';

const detectProviderMock = detectProvider as unknown as ReturnType<
  typeof vi.fn
>;

// Control CODEOWNERS resolution without touching the filesystem.
const codeowners = vi.hoisted(() => ({
  resolveCodeOwners: vi.fn((): string[] => []),
}));
vi.mock('./codeowners/index.js', () => codeowners);

import { makeDryRunTransport } from './dry-run-transport.js';
import VitestSentryReporter from './reporter.js';

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

function makeTestCase(opts: {
  id: string;
  name?: string;
  state?: 'failed' | 'passed';
  message?: string;
  errors?: unknown[];
}): TestCase {
  return {
    id: opts.id,
    name: opts.name ?? opts.id,
    fullName: opts.name ?? opts.id,
    module: { moduleId: '/tests/x.test.ts' },
    project: { name: 'unit' },
    parent: { type: 'module' as const },
    result: () => ({
      state: opts.state ?? 'failed',
      errors:
        opts.errors ??
        (opts.state === 'passed'
          ? []
          : [{ message: opts.message ?? 'boom', stack: 'STACK' }]),
    }),
    diagnostic: () => ({ duration: 1, retryCount: 0, flaky: false }),
  } as unknown as TestCase;
}

function makeScope() {
  return {
    setTags: vi.fn(),
    setExtras: vi.fn(),
    setExtra: vi.fn(),
    setContext: vi.fn(),
    setFingerprint: vi.fn(),
    setUser: vi.fn(),
    addEventProcessor: vi.fn(),
  };
}

function makeModule(testCases: TestCase[]): TestModule {
  return {
    children: {
      *allTests(state?: string) {
        for (const tc of testCases) {
          if (!state || tc.result().state === state) yield tc;
        }
      },
    },
  } as unknown as TestModule;
}

describe('VitestSentryReporter (Vitest 4 API)', () => {
  beforeEach(() => {
    sentry.init.mockClear();
    sentry.flush.mockClear();
    sentry.captureException.mockClear();
    sentry.withScope.mockClear();
    codeowners.resolveCodeOwners.mockReset();
    codeowners.resolveCodeOwners.mockReturnValue([]);
    // Default to "no CI provider" so detection stays quiet unless a test opts in.
    detectProviderMock.mockReset();
    detectProviderMock.mockReturnValue(undefined);
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_ENVIRONMENT;
    delete process.env.SENTRY_RELEASE;
  });

  it('reports one event per failed test and flushes once', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1', message: 'bad assertion' });

    reporter.onTestCaseResult(failed);
    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const err = sentry.captureException.mock.calls[0][0] as Error;
    expect(err.message).toBe('bad assertion');
    expect(sentry.flush).toHaveBeenCalledTimes(1);
  });

  it('does not double-report a test seen by both onTestCaseResult and the end sweep', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    reporter.onTestCaseResult(failed);
    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('reports failures discovered only in the end-of-run sweep', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    // No onTestCaseResult call — e.g. failure surfaced only at run end.
    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('ignores passing tests', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const passed = makeTestCase({ id: 't1', state: 'passed' });

    reporter.onTestCaseResult(passed);
    await reporter.onTestRunEnd([makeModule([passed])], [], 'passed');

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('caps reported events at maxEventsPerRun', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN, maxEventsPerRun: 2 });
    const cases = [1, 2, 3, 4].map((n) => makeTestCase({ id: `t${n}` }));

    await reporter.onTestRunEnd([makeModule(cases)], [], 'failed');

    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('honors the shouldReport predicate', async () => {
    const reporter = new VitestSentryReporter({
      dsn: DSN,
      shouldReport: (ctx) => ctx.testName !== 'skip-me',
    });
    const reported = makeTestCase({ id: 't1', name: 'keep-me' });
    const skipped = makeTestCase({ id: 't2', name: 'skip-me' });

    await reporter.onTestRunEnd(
      [makeModule([reported, skipped])],
      [],
      'failed',
    );

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('stays disabled and silent when no DSN is configured', async () => {
    delete process.env.SENTRY_DSN;
    const reporter = new VitestSentryReporter({});
    const failed = makeTestCase({ id: 't1' });

    reporter.onTestCaseResult(failed);
    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports detected trigger and actor tags on every failure', async () => {
    const setTags = vi.fn();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb({
        setTags,
        setExtras: vi.fn(),
        setContext: vi.fn(),
        setFingerprint: vi.fn(),
        setUser: vi.fn(),
        addEventProcessor: vi.fn(),
      }),
    );
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(setTags).toHaveBeenCalledTimes(1);
    const tags = setTags.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof tags.trigger).toBe('string');
    expect(['ai', 'bot', 'human']).toContain(tags.actor_type);
    expect(typeof tags.actor_name).toBe('string');
  });

  it('lets manually specified tags override detected trigger/actor markers', async () => {
    const setTags = vi.fn();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb({
        setTags,
        setExtras: vi.fn(),
        setContext: vi.fn(),
        setFingerprint: vi.fn(),
        setUser: vi.fn(),
        addEventProcessor: vi.fn(),
      }),
    );
    const reporter = new VitestSentryReporter({
      dsn: DSN,
      tags: { trigger: 'cron', actor_type: 'bot' },
      getTags: () => ({ actor_name: 'nightly-canary' }),
    });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(setTags).toHaveBeenCalledTimes(1);
    expect(setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        trigger: 'cron',
        actor_type: 'bot',
        actor_name: 'nightly-canary',
      }),
    );
  });

  it('tags the failure with the Vitest project name', async () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({ test_project: 'unit' }),
    );
  });

  it('attaches a clickable ci context and run_url tag from the active provider', async () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    detectProviderMock.mockReturnValue({
      name: 'circleci',
      isActive: () => true,
      repository: () => 'acme/widgets',
      branch: () => 'main',
      commitSha: () => 'abc123',
      runUrl: () => 'https://circleci.com/build/1',
      workflowId: () => 'wf-1',
      rootPath: () => undefined,
      envSnapshot: () => ({}),
    });
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    // The circleci mock exposes no PR/commit URL, so only run_url/workflow_id appear.
    expect(scope.setContext).toHaveBeenCalledWith('ci', {
      run_url: 'https://circleci.com/build/1',
      workflow_id: 'wf-1',
    });
    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({ run_url: 'https://circleci.com/build/1' }),
    );
  });

  it('attaches a ci context with all provider links and skips it locally', async () => {
    // Local run: no provider detected, so no ci context is attached.
    const localScope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(localScope),
    );
    const localReporter = new VitestSentryReporter({ dsn: DSN });
    await localReporter.onTestRunEnd(
      [makeModule([makeTestCase({ id: 't1' })])],
      [],
      'failed',
    );
    expect(localScope.setContext).not.toHaveBeenCalledWith(
      'ci',
      expect.anything(),
    );

    // CI run: the detected provider's links are attached as a `ci` context.
    const ciScope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(ciScope),
    );
    detectProviderMock.mockReturnValue({
      name: 'github',
      repository: () => 'acme/widgets',
      branch: () => 'main',
      commitSha: () => 'abc123',
      rootPath: () => undefined,
      runUrl: () => 'https://gh/run/1',
      pullRequestUrl: () => 'https://gh/pull/2',
      commitUrl: () => 'https://gh/commit/abc123',
      workflowId: () => '1',
    });
    const ciReporter = new VitestSentryReporter({ dsn: DSN });
    await ciReporter.onTestRunEnd(
      [makeModule([makeTestCase({ id: 't2' })])],
      [],
      'failed',
    );
    expect(ciScope.setContext).toHaveBeenCalledWith('ci', {
      run_url: 'https://gh/run/1',
      pull_request_url: 'https://gh/pull/2',
      commit_url: 'https://gh/commit/abc123',
      workflow_id: '1',
    });
  });

  it('omits the ci context when no provider is detected', async () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(scope.setContext).not.toHaveBeenCalledWith('ci', expect.anything());
    expect(scope.setTags.mock.calls[0][0]).not.toHaveProperty('run_url');
  });

  it('attaches buffered console logs to the failure context', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    reporter.onUserConsoleLog({
      taskId: 't1',
      type: 'stdout',
      content: 'hello from test',
    });
    reporter.onTestCaseResult(failed);
    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('appends to the log buffer per task and ignores logs without a task id', async () => {
    const setExtras = vi.fn();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb({ ...makeScope(), setExtras }),
    );
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    reporter.onUserConsoleLog({ taskId: 't1', type: 'stdout', content: 'one' });
    reporter.onUserConsoleLog({ taskId: 't1', type: 'stderr', content: 'two' });
    reporter.onUserConsoleLog({ type: 'stdout', content: 'orphan' });
    reporter.onTestCaseResult(failed);
    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(setExtras).toHaveBeenCalledWith(
      expect.objectContaining({ logs: ['one', 'two'] }),
    );
  });

  it('onInit is a lazy no-op that touches no Sentry API', () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    reporter.onInit();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('passes real Error instances through to captureException', async () => {
    const realError = new Error('actual failure');
    realError.name = 'AssertionError';
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1', errors: [realError] });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured).toBe(realError);
    expect(captured.name).toBe('AssertionError');
  });

  it('synthesizes an error from the test title when the failure has no error', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({
      id: 't1',
      name: 'no error object',
      errors: [],
    });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.message).toBe('no error object');
    expect(captured.stack).toBeUndefined();
  });

  it('keeps an Error instance untouched when it lacks a stack', async () => {
    const realError = new Error('stackless');
    realError.stack = undefined;
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1', errors: [realError] });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(sentry.captureException.mock.calls[0][0]).toBe(realError);
  });

  it('strips the synthetic stack when the failure has none of its own', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({
      id: 't1',
      errors: [{ message: 'plain failure' }],
    });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.message).toBe('plain failure');
    expect(captured.stack).toBeUndefined();
  });

  it('copies the error name from serialized error objects', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({
      id: 't1',
      errors: [{ message: 'boom', stack: 'STACK', name: 'TypeError' }],
    });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    const captured = sentry.captureException.mock.calls[0][0] as Error;
    expect(captured.name).toBe('TypeError');
    expect(captured.stack).toBe('STACK');
  });

  it('applies custom fingerprint and user from the options', async () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const reporter = new VitestSentryReporter({
      dsn: DSN,
      getFingerprint: () => ['custom', 'fingerprint'],
      getUser: () => ({ id: 'user-1' }),
    });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(scope.setFingerprint).toHaveBeenCalledWith([
      'custom',
      'fingerprint',
    ]);
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('wires beforeSend as an event processor receiving the failure context', async () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    const beforeSend = vi.fn((event: Event) => event);
    const reporter = new VitestSentryReporter({ dsn: DSN, beforeSend });
    const failed = makeTestCase({ id: 't1', name: 'wired test' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(scope.addEventProcessor).toHaveBeenCalledTimes(1);
    const processor = scope.addEventProcessor.mock.calls[0][0] as (
      event: unknown,
      hint: unknown,
    ) => unknown;
    const event = { event_id: 'e1' };
    const hint = { originalException: 'x' };
    expect(processor(event, hint)).toBe(event);
    expect(beforeSend).toHaveBeenCalledWith(
      event,
      hint,
      expect.objectContaining({ testName: 'wired test' }),
    );
  });

  it('stays disabled when enabled is explicitly false', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN, enabled: false });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('warns and disables itself when enabled without a DSN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reporter = new VitestSentryReporter({ enabled: true });
      const failed = makeTestCase({ id: 't1' });

      await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

      expect(sentry.init).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('SENTRY_DSN missing'),
      );
      expect(sentry.flush).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('dryRun initializes with a placeholder DSN, debug and a logging transport', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const reporter = new VitestSentryReporter({ dryRun: true });
      const failed = makeTestCase({ id: 't1' });

      await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

      expect(sentry.init).toHaveBeenCalledTimes(1);
      const options = sentry.init.mock.calls[0][0] as {
        dsn: string;
        debug: boolean;
        tracesSampleRate: number;
        transport: unknown;
        integrations: (defaults: Array<{ name: string }>) => Array<{
          name: string;
        }>;
      };
      expect(options.dsn).toBe(
        'https://examplePublicKey@o0.ingest.sentry.io/0',
      );
      expect(options.debug).toBe(true);
      expect(options.tracesSampleRate).toBe(0);
      expect(options.transport).toBe(makeDryRunTransport);
      expect(sentry.captureException).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it('does not resolve code owners unless the option is enabled', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(codeowners.resolveCodeOwners).not.toHaveBeenCalled();
  });

  it('attaches code_owners and code_owner tags when enabled', async () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    codeowners.resolveCodeOwners.mockReturnValue(['@acme/api', '@alice']);
    const reporter = new VitestSentryReporter({ dsn: DSN, codeowners: true });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        code_owners: '@acme/api,@alice',
        code_owner: '@acme/api',
      }),
    );
    expect(scope.setExtra).toHaveBeenCalledWith('code_owners', [
      '@acme/api',
      '@alice',
    ]);
  });

  it('omits code owner tags when no owners match', async () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    codeowners.resolveCodeOwners.mockReturnValue([]);
    const reporter = new VitestSentryReporter({ dsn: DSN, codeowners: true });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    const tags = scope.setTags.mock.calls[0][0] as Record<string, unknown>;
    expect(tags).not.toHaveProperty('code_owners');
    expect(tags).not.toHaveProperty('code_owner');
    expect(scope.setExtra).not.toHaveBeenCalled();
  });

  it('lets manually specified tags override resolved code owners', async () => {
    const scope = makeScope();
    sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
      cb(scope),
    );
    codeowners.resolveCodeOwners.mockReturnValue(['@acme/api']);
    const reporter = new VitestSentryReporter({
      dsn: DSN,
      codeowners: true,
      getTags: () => ({ code_owner: '@platform', code_owners: '@platform' }),
    });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        code_owner: '@platform',
        code_owners: '@platform',
      }),
    );
  });

  it('keeps only the minimal default integrations', async () => {
    const reporter = new VitestSentryReporter({ dsn: DSN });
    const failed = makeTestCase({ id: 't1' });

    await reporter.onTestRunEnd([makeModule([failed])], [], 'failed');

    const options = sentry.init.mock.calls[0][0] as {
      integrations: (defaults: Array<{ name: string }>) => Array<{
        name: string;
      }>;
    };
    const kept = options.integrations([
      { name: 'InboundFilters' },
      { name: 'Http' },
      { name: 'ContextLines' },
      { name: 'OnUncaughtException' },
    ]);
    expect(kept.map((integration) => integration.name)).toEqual([
      'InboundFilters',
      'ContextLines',
    ]);
  });
});

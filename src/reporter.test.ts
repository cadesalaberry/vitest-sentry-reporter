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

import VitestSentryReporter from './reporter.js';

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

function makeTestCase(opts: {
  id: string;
  name?: string;
  state?: 'failed' | 'passed';
  message?: string;
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
        opts.state === 'passed'
          ? []
          : [{ message: opts.message ?? 'boom', stack: 'STACK' }],
    }),
    diagnostic: () => ({ duration: 1, retryCount: 0, flaky: false }),
  } as unknown as TestCase;
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
});

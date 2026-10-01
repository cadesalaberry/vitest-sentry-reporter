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

// Control automatic identity detection so it never shells out to git.
const identity = vi.hoisted(() => ({
  detectIdentities: vi.fn(() => ({}) as unknown),
}));
vi.mock('./identity.js', () => identity);

import { makeDryRunTransport } from './dry-run-transport.js';
import type { DetectedIdentities } from './identity.js';
import VitestSentryReporter from './reporter.js';
import type { FailureContext } from './types.js';

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
    identity.detectIdentities.mockReset();
    identity.detectIdentities.mockReturnValue({});
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

  // Both people, as detectIdentities returns them for a local human run.
  const DETECTED: DetectedIdentities = {
    developer: {
      username: 'Jane Dev',
      email: 'jane@acme.test',
      pseudonymizedId: 'dev-a0a0a0a0a0a0a0a0',
    },
    committer: {
      username: 'Pat Opener',
      email: 'pat@acme.test',
      pseudonymizedId: 'dev-c0c0c0c0c0c0c0c0',
    },
  };

  type Options = ConstructorParameters<typeof VitestSentryReporter>[0];

  /** Run `count` failing tests through the reporter, and return their scopes. */
  async function reportFailures(options: Options, count = 1) {
    const scopes = Array.from({ length: count }, () => makeScope());
    for (const scope of scopes) {
      sentry.withScope.mockImplementationOnce((cb: (scope: unknown) => void) =>
        cb(scope),
      );
    }
    const reporter = new VitestSentryReporter({ dsn: DSN, ...options });
    const cases = scopes.map((_, n) => makeTestCase({ id: `t${n + 1}` }));
    await reporter.onTestRunEnd([makeModule(cases)], [], 'failed');
    return scopes;
  }

  /** Run one failing test through the reporter, and return its scope. */
  async function reportOneFailure(options: Options) {
    const [scope] = await reportFailures(options);
    return scope as ReturnType<typeof makeScope>;
  }

  /** Silence and capture the reporter warnings for one test. */
  function captureWarnings() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
  }

  it('sends only the developer pseudonym by default', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);

    const scope = await reportOneFailure({});

    expect(identity.detectIdentities).toHaveBeenCalledWith(process.env);
    // No username and no email: only the opaque id leaves the machine.
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'dev-a0a0a0a0a0a0a0a0' });
    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        triggered_by: 'dev-a0a0a0a0a0a0a0a0',
        user_source: 'developer',
      }),
    );
  });

  it('falls back to the committer when no developer is detected', async () => {
    // For example a run that a bot triggers.
    identity.detectIdentities.mockReturnValue({
      committer: DETECTED.committer,
    });

    const scope = await reportOneFailure({});

    expect(scope.setUser).toHaveBeenCalledWith({ id: 'dev-c0c0c0c0c0c0c0c0' });
    // The tag tells that this person made the commit, and did not run the tests.
    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({ user_source: 'committer' }),
    );
  });

  it('reads the committer only when there is no developer', async () => {
    // The first read of `committer` runs `git log`.
    const readCommitter = vi.fn(() => DETECTED.committer);
    identity.detectIdentities.mockReturnValue({
      developer: DETECTED.developer,
      get committer() {
        return readCommitter();
      },
    });

    const scope = await reportOneFailure({});

    expect(scope.setUser).toHaveBeenCalledWith({ id: 'dev-a0a0a0a0a0a0a0a0' });
    expect(readCommitter).not.toHaveBeenCalled();
  });

  it('sends no user and no tag when nobody is detected', async () => {
    identity.detectIdentities.mockReturnValue({});

    const scope = await reportOneFailure({});

    expect(scope.setUser).not.toHaveBeenCalled();
    expect(scope.setTags.mock.calls[0][0]).not.toHaveProperty('triggered_by');
    expect(scope.setTags.mock.calls[0][0]).not.toHaveProperty('user_source');
  });

  it('passes the failure context and the detection to getUser', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);
    const getUser = vi.fn(
      (_ctx: FailureContext, { developer }: DetectedIdentities) =>
        developer
          ? { id: developer.pseudonymizedId, username: developer.username }
          : undefined,
    );

    const scope = await reportOneFailure({ getUser });

    expect(getUser).toHaveBeenCalledWith(
      expect.objectContaining({ testName: 't1' }),
      DETECTED,
    );
    expect(scope.setUser).toHaveBeenCalledWith({
      id: 'dev-a0a0a0a0a0a0a0a0',
      username: 'Jane Dev',
    });
    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        triggered_by: 'Jane Dev',
        user_source: 'developer',
      }),
    );
  });

  it('keeps a 1.5.0 getUser(ctx) function working', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);
    const warn = captureWarnings();

    const scope = await reportOneFailure({
      getUser: (ctx) => ({ id: `owner-of-${ctx.testName}` }),
    });

    expect(scope.setUser).toHaveBeenCalledWith({ id: 'owner-of-t1' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sets user_source by the fields that a custom getUser returns', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);

    const [byEmail, byStaticId] = await reportFailures(
      {
        getUser: (ctx, { committer: c }) =>
          ctx.testName === 't1' ? c && { email: c.email } : { id: 'qa-team' },
      },
      2,
    );

    expect(byEmail?.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({ user_source: 'committer' }),
    );
    // A user that matches neither person gets no source.
    expect(byStaticId?.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({ triggered_by: 'qa-team' }),
    );
    expect(byStaticId?.setTags.mock.calls[0][0]).not.toHaveProperty(
      'user_source',
    );
  });

  it('sends the email only when getUser returns it', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);

    const scope = await reportOneFailure({
      getUser: (_ctx, { developer: d }) =>
        d && { id: d.pseudonymizedId, email: d.email },
    });

    expect(scope.setUser).toHaveBeenCalledWith({
      id: 'dev-a0a0a0a0a0a0a0a0',
      email: 'jane@acme.test',
    });
  });

  it('lets getUser pick a different user for each failure', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);
    const getUser = vi.fn((ctx: FailureContext) =>
      ctx.testName === 't1' ? { id: 'team-payments' } : undefined,
    );

    const [first, second] = await reportFailures({ getUser }, 2);

    expect(first?.setUser).toHaveBeenCalledWith({ id: 'team-payments' });
    expect(second?.setUser).not.toHaveBeenCalled();
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('skips detection and sends no user when getUser is false', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);

    const scope = await reportOneFailure({ getUser: false });

    expect(identity.detectIdentities).not.toHaveBeenCalled();
    expect(scope.setUser).not.toHaveBeenCalled();
    expect(scope.setTags.mock.calls[0][0]).not.toHaveProperty('triggered_by');
    expect(scope.setTags.mock.calls[0][0]).not.toHaveProperty('user_source');
  });

  it('falls back to the default for a value that is not a function', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);

    // A JavaScript config can carry any value. The type rejects this one.
    const scope = await reportOneFailure({
      getUser: true,
    } as unknown as Options);

    expect(scope.setUser).toHaveBeenCalledWith({ id: 'dev-a0a0a0a0a0a0a0a0' });
  });

  it('sends no user, and logs nothing, when getUser returns undefined', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);
    const warn = captureWarnings();

    const scope = await reportOneFailure({ getUser: () => undefined });

    expect(scope.setUser).not.toHaveBeenCalled();
    expect(scope.setTags.mock.calls[0][0]).not.toHaveProperty('triggered_by');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns once when getUser returns a value that is not a Sentry user', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);
    const warn = captureWarnings();

    // In JavaScript, `(_ctx, { developer }) => developer?.pseudonymizedId`
    // returns a string.
    const scopes = await reportFailures(
      {
        getUser: ((_ctx: FailureContext, { developer }: DetectedIdentities) =>
          developer?.pseudonymizedId) as unknown as Options['getUser'],
      },
      2,
    );

    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    for (const scope of scopes) expect(scope.setUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('getUser returned a string');
    warn.mockRestore();
  });

  it('warns when getUser returns an object without an id, a username or an email', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);
    const warn = captureWarnings();

    const scope = await reportOneFailure({ getUser: () => ({}) });

    expect(scope.setUser).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain(
      'an object without an id, a username or an email',
    );
    warn.mockRestore();
  });

  it('still reports every failure, with no user, when getUser throws', async () => {
    const warn = captureWarnings();

    const scopes = await reportFailures(
      {
        getUser: (_ctx, { developer }) => ({
          id: (developer as { id: string }).id,
        }),
      },
      2,
    );

    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    for (const scope of scopes) expect(scope.setUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('getUser threw an error');
    warn.mockRestore();
  });

  it('warns once that the 1.5.0 identity option has no effect', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);
    const warn = captureWarnings();

    const scope = await reportOneFailure({
      identity: { includeEmail: true },
    } as Options);

    // The leftover key changes nothing: the default still sends the pseudonym.
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'dev-a0a0a0a0a0a0a0a0' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      '"identity" option no longer exists',
    );
    expect(warn.mock.calls[0][0]).toContain('Use "getUser" instead');
    warn.mockRestore();
  });

  it('lets manual tags override the detected triggered_by and user_source', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);

    const scope = await reportOneFailure({
      tags: { triggered_by: 'release-bot', user_source: 'release' },
    });

    expect(scope.setTags.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        triggered_by: 'release-bot',
        user_source: 'release',
      }),
    );
  });

  it('detects the developer once per run, and calls getUser per failure', async () => {
    identity.detectIdentities.mockReturnValue(DETECTED);
    const getUser = vi.fn(
      (_ctx: FailureContext, { developer }: DetectedIdentities) =>
        developer ? { id: developer.pseudonymizedId } : undefined,
    );

    await reportFailures({ getUser }, 3);

    expect(sentry.captureException).toHaveBeenCalledTimes(3);
    expect(identity.detectIdentities).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(3);
  });
});

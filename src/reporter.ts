import type { NodeOptions } from '@sentry/node';
import { captureException, flush, init, withScope } from '@sentry/node';
import type {
  Reporter,
  SerializedError,
  TestCase,
  TestModule,
  TestRunEndReason,
} from 'vitest/node';
import { resolveCodeOwners } from './codeowners/index.js';
import { makeDryRunTransport } from './dry-run-transport.js';
import type {
  FailureContext,
  Primitive,
  VitestSentryReporterOptions,
  VitestUserConsoleLog,
} from './types.js';
import {
  baseTags,
  ciContext,
  cleanRecord,
  commitSha,
  extras,
  inferEnvironment,
  MANUALLY_OVERRIDABLE_TAGS,
  repoRoot,
  toFailureContext,
} from './utils.js';

export class VitestSentryReporter implements Reporter {
  public name: string;
  private options: VitestSentryReporterOptions;
  private enabled: boolean;
  private initialized: boolean;
  private reportedIds: Set<string>;
  private queued: FailureContext[];
  private logsByTask: Map<string, string[]>;
  private maxEventsPerRun?: number;
  private codeownersEnabled: boolean;
  private codeownersRoot?: string;

  constructor(options: VitestSentryReporterOptions = {}) {
    this.name = 'vitest-sentry-reporter';
    this.options = options;
    this.enabled = this.resolveEnabled(options);
    this.initialized = false;
    this.reportedIds = new Set<string>();
    this.queued = [];
    this.logsByTask = new Map<string, string[]>();
    this.maxEventsPerRun = options.maxEventsPerRun;

    const co = options.codeowners;
    this.codeownersEnabled =
      co === true ||
      (typeof co === 'object' && co !== null && co.enabled !== false);
    this.codeownersRoot = this.codeownersEnabled
      ? typeof co === 'object' && co?.root
        ? co.root
        : repoRoot()
      : undefined;
  }

  onInit(): void {
    // Lazy init: only initialize Sentry when we actually need to report a failure.
    // This avoids doing work or emitting logs when there are zero tests or no failures.
    return;
  }

  onUserConsoleLog(log: VitestUserConsoleLog): void {
    // Buffer console output per test so it can be attached to the failure event.
    if (!log.taskId) return;
    const existing = this.logsByTask.get(log.taskId);
    if (existing) existing.push(log.content);
    else this.logsByTask.set(log.taskId, [log.content]);
  }

  onTestCaseResult(testCase: TestCase): void {
    // Collect failures as they happen so reporting stays incremental.
    if (testCase.result().state !== 'failed') return;
    this.collectFailure(testCase);
  }

  async onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    _unhandledErrors: ReadonlyArray<SerializedError>,
    _reason: TestRunEndReason,
  ): Promise<void> {
    try {
      // Defensive sweep: catch any failed test not seen via onTestCaseResult.
      for (const testModule of testModules) {
        for (const testCase of testModule.children.allTests('failed')) {
          this.collectFailure(testCase);
        }
      }

      let sent = 0;
      for (const ctx of this.queued) {
        if (this.maxEventsPerRun && sent >= this.maxEventsPerRun) break;
        this.reportFailure(ctx);
        sent++;
      }
    } finally {
      if (this.enabled && this.initialized) {
        await flush(3000).catch(() => void 0);
      }
    }
  }

  private collectFailure(testCase: TestCase): void {
    if (this.reportedIds.has(testCase.id)) return;
    this.reportedIds.add(testCase.id);
    const ctx = toFailureContext(testCase, this.logsByTask.get(testCase.id));
    this.enqueueFailure(ctx);
  }

  private enqueueFailure(ctx: FailureContext): void {
    const shouldReport = this.options.shouldReport
      ? this.options.shouldReport(ctx)
      : true;
    if (!shouldReport) return;
    this.queued.push(ctx);
  }

  private reportFailure(ctx: FailureContext): void {
    if (!this.enabled) return;
    if (!this.initialized) this.initSentry();

    const manualTags = {
      ...cleanRecord(this.options.tags),
      ...cleanRecord(this.options.getTags?.(ctx)),
    };
    const owners = this.resolveOwners(ctx);
    const codeOwnerTags: Record<string, Primitive> =
      owners.length > 0
        ? { code_owners: owners.join(','), code_owner: owners[0] }
        : {};
    const mergedTags = {
      ...manualTags,
      ...cleanRecord(baseTags(ctx)),
      ...cleanRecord(codeOwnerTags),
    } as Record<string, Primitive>;
    // Detected trigger/actor markers yield to manually specified tags.
    for (const key of MANUALLY_OVERRIDABLE_TAGS) {
      if (key in manualTags) mergedTags[key] = manualTags[key];
    }

    const fingerprint = this.options.getFingerprint?.(ctx) ?? [
      'vitest-failure',
      // Repo-relative so the same failure groups across local and CI checkouts.
      ctx.relativeFilePath ?? ctx.filePath ?? 'unknown-file',
      ctx.testName,
    ];

    const testContext = {
      file: ctx.filePath,
      name: ctx.testName,
      fullTitle: ctx.fullTitle,
      durationMs: ctx.durationMs,
      retry: ctx.retry,
      flaky: ctx.flaky,
    };

    const error =
      ctx.error instanceof Error
        ? ctx.error
        : new Error(ctx.message ?? ctx.fullTitle ?? ctx.testName);

    // If we have a stack from the failure context, use it.
    if (ctx.stack) {
      error.stack = ctx.stack;
    } else {
      // If we created a synthetic error and have no stack from the context,
      // the error.stack will point to this line in the reporter.
      // We remove it to avoid confusing the user with reporter internals.
      if (!(ctx.error instanceof Error)) {
        error.stack = undefined;
      }
    }

    if (ctx.error && typeof ctx.error === 'object') {
      if ('name' in ctx.error)
        error.name = String((ctx.error as { name: unknown }).name);
    }

    withScope((scope) => {
      scope.setTags(mergedTags);
      scope.setExtras(extras(ctx));
      if (owners.length > 0) scope.setExtra('code_owners', owners);
      scope.setContext('test', testContext);
      const ci = ciContext();
      if (Object.keys(ci).length > 0) scope.setContext('ci', ci);
      scope.setFingerprint(fingerprint);

      const user = this.options.getUser?.(ctx);
      if (user) scope.setUser(user);

      if (this.options.beforeSend) {
        const beforeSend = this.options.beforeSend;
        scope.addEventProcessor((event, hint) => beforeSend(event, hint, ctx));
      }

      captureException(error);
    });
  }

  private initSentry(): void {
    if (this.initialized) return;
    const providedDsn = this.options.dsn ?? process.env.SENTRY_DSN;
    const isDryRun = Boolean(this.options.dryRun);
    const dsn =
      providedDsn ??
      (isDryRun ? 'https://examplePublicKey@o0.ingest.sentry.io/0' : undefined);
    if (!dsn) {
      this.enabled = false;
      // eslint-disable-next-line no-console
      console.warn(
        '[vitest-sentry-reporter] SENTRY_DSN missing; reporter disabled',
      );
      return;
    }

    if (isDryRun)
      console.log(
        '[vitest-sentry-reporter] initializing Sentry with DSN:',
        dsn,
      );
    const environment =
      this.options.environment ??
      process.env.SENTRY_ENVIRONMENT ??
      inferEnvironment();
    const release =
      this.options.release ??
      process.env.SENTRY_RELEASE ??
      commitSha() ??
      undefined;

    const minimalIntegrationNames = new Set([
      'InboundFilters',
      'FunctionToString',
      'LinkedErrors',
      'ContextLines',
      'Context',
    ]);

    const initOptions: NodeOptions = {
      dsn,
      environment,
      release,
      dist: release,
      debug: isDryRun,
      integrations: (defaults) =>
        defaults.filter((integration) =>
          minimalIntegrationNames.has(integration.name),
        ),
      tracesSampleRate: 0,
      ...(this.options.sentryOptions ?? {}),
    };

    if (isDryRun) {
      // Use a custom transport that logs envelopes instead of sending
      initOptions.transport = makeDryRunTransport;
    }

    init(initOptions);
    this.initialized = true;
  }

  private resolveEnabled(options: VitestSentryReporterOptions): boolean {
    if (typeof options.enabled === 'boolean') return options.enabled;
    if (options.dryRun) return true;
    return Boolean(options.dsn ?? process.env.SENTRY_DSN);
  }

  private resolveOwners(ctx: FailureContext): string[] {
    if (!this.codeownersEnabled || !this.codeownersRoot) return [];
    return resolveCodeOwners(ctx.filePath, this.codeownersRoot);
  }
}

export default VitestSentryReporter;

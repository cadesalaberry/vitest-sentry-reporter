import { init, flush, withScope, captureException } from '@sentry/node';
import type { RunnerTestFile as File } from 'vitest';
import type { NodeOptions, User } from '@sentry/node';
import { makeDryRunTransport } from './dry-run-transport.js';
import type { FailureContext, VitestSentryReporterOptions, TaskUpdatePack, VitestTaskLike, VitestTaskResult, Primitive } from './types.js';
import { toFailureContext, baseTags, cleanRecord, extras, inferEnvironment, commitSha } from './utils.js';

export class VitestSentryReporter {
  public name: string;
  private options: VitestSentryReporterOptions;
  private enabled: boolean;
  private initialized: boolean;
  private reportedIds: Set<string>;
  private queued: FailureContext[];
  private maxEventsPerRun?: number;

  constructor(options: VitestSentryReporterOptions = {}) {
    this.name = 'vitest-sentry-reporter';
    this.options = options;
    this.enabled = this.resolveEnabled(options);
    this.initialized = false;
    this.reportedIds = new Set<string>();
    this.queued = [];
    this.maxEventsPerRun = options.maxEventsPerRun;
  }

  onInit(): void {
    // Lazy init: only initialize Sentry when we actually need to report a failure.
    // This avoids doing work or emitting logs when there are zero tests or no failures.
    return;
  }

  onTaskUpdate(packs: TaskUpdatePack[]): void {
    if (!Array.isArray(packs)) return;
    for (const pack of packs) {
      const task: VitestTaskLike = Array.isArray(pack) ? pack[0] : pack.task;
      const result: VitestTaskResult | undefined = Array.isArray(pack) ? pack[1] : pack.result;
      const state = result?.state ?? task.state;
      if (state !== 'fail') continue;

      const id = String(task?.id ?? task?.name ?? Math.random());
      if (this.reportedIds.has(id)) continue;
      const ctx = toFailureContext(task, result);
      this.enqueueFailure(ctx);
      this.reportedIds.add(id);
    }
  }


  async onTestRunEnd(testModules: File[], unhandledErrors: unknown[]): Promise<void> {
    try {
      if (Array.isArray(testModules)) {
        for (const file of testModules) {
          const tasks = Array.isArray(file?.tasks) ? file.tasks : [];
          for (const t of tasks) {
            const task = t as unknown as VitestTaskLike;
            const result = task.result;
            const state = result?.state ?? task.state;
            if (state !== 'fail') continue;
            const id = String(task.id ?? task.name ?? Math.random());
            if (this.reportedIds.has(id)) continue;
            const ctx = toFailureContext(task, result);
            this.enqueueFailure(ctx);
            this.reportedIds.add(id);
          }
        }
      }

      for (const ctx of this.queued) {
        this.reportFailure(ctx);
        if (this.maxEventsPerRun && this.reportedIds.size >= this.maxEventsPerRun) break;
      }
    } finally {
      if (this.enabled && this.initialized) {
        await flush(3000).catch(() => void 0);
      }
    }
  }

  private enqueueFailure(ctx: FailureContext): void {
    const shouldReport = this.options.shouldReport ? this.options.shouldReport(ctx) : true;
    if (!shouldReport) return;
    this.queued.push(ctx);
  }

  private reportFailure(ctx: FailureContext): void {
    if (!this.enabled) return;
    if (!this.initialized) this.initSentry();

    const mergedTags = {
      ...cleanRecord(this.options.tags),
      ...cleanRecord(this.options.getTags?.(ctx)),
      ...cleanRecord(baseTags(ctx)),
    } as Record<string, Primitive>;

    const fingerprint = this.options.getFingerprint?.(ctx) ?? [
      'vitest-failure',
      ctx.filePath ?? 'unknown-file',
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

    const error = (ctx.error instanceof Error)
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
      if ('name' in ctx.error) error.name = String((ctx.error as { name: unknown }).name);
    }

    withScope((scope) => {
      scope.setTags(mergedTags);
      scope.setExtras(extras(ctx));
      scope.setContext('test', testContext);
      scope.setFingerprint(fingerprint);

      const user = this.options.getUser?.(ctx);
      if (user) scope.setUser(user);

      if (this.options.beforeSend) {
        scope.addEventProcessor((event, hint) => this.options.beforeSend!(event, hint, ctx));
      }

      captureException(error);
    });
  }

  private initSentry(): void {
    if (this.initialized) return;
    const providedDsn = this.options.dsn ?? process.env.SENTRY_DSN;
    const isDryRun = Boolean(this.options.dryRun);
    const dsn = providedDsn ?? (isDryRun ? 'https://examplePublicKey@o0.ingest.sentry.io/0' : undefined);
    if (!dsn) {
      this.enabled = false;
      // eslint-disable-next-line no-console
      console.warn('[vitest-sentry-reporter] SENTRY_DSN missing; reporter disabled');
      return;
    }

    console.log('[vitest-sentry-reporter] initializing Sentry with DSN:', dsn);
    const environment = this.options.environment ?? process.env.SENTRY_ENVIRONMENT ?? inferEnvironment();
    const release = this.options.release ?? process.env.SENTRY_RELEASE ?? commitSha() ?? undefined;

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
      debug: true || isDryRun,
      integrations: (defaults) => defaults.filter((integration) => minimalIntegrationNames.has(integration.name)),
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
}

export default VitestSentryReporter;



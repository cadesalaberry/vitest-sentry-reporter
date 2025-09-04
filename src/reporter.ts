import { init, flush, withScope, captureException } from '@sentry/node';
import type { User } from '@sentry/node';
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
    if (!this.enabled) return;
    this.initSentry();
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

  onFinished(files?: { tasks?: VitestTaskLike[] }[]): void {
    try {
      if (Array.isArray(files)) {
        for (const file of files) {
          const tasks = Array.isArray(file?.tasks) ? file.tasks : [];
          for (const t of tasks) {
            const result = t.result;
            const state = result?.state ?? t.state;
            if (state !== 'fail') continue;
            const id = String(t?.id ?? t?.name ?? Math.random());
            if (this.reportedIds.has(id)) continue;
            const ctx = toFailureContext(t, result);
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
      if (this.enabled && this.initialized && !this.options.dryRun) {
        flush(3000).catch(() => void 0);
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

    if (this.options.dryRun) {
      // eslint-disable-next-line no-console
      console.warn('[vitest-sentry-reporter] dryRun on – would report:', {
        message: ctx.message,
        tags: mergedTags,
        fingerprint,
      });
      return;
    }

    withScope((scope) => {
      Object.entries(mergedTags).forEach(([k, v]) => v != null && scope.setTag(k, String(v)));
      Object.entries(extras(ctx)).forEach(([k, v]) => scope.setExtra(k, v as unknown as Primitive));
      scope.setContext('test', {
        file: ctx.filePath,
        name: ctx.testName,
        fullTitle: ctx.fullTitle,
        durationMs: ctx.durationMs,
        retry: ctx.retry,
        flaky: ctx.flaky,
      });
      scope.setFingerprint(fingerprint);

      const user = this.options.getUser?.(ctx);
      if (user) scope.setUser(user as User);

      if (this.options.beforeSend) {
        scope.addEventProcessor((event, hint) => this.options.beforeSend!(event, hint, ctx));
      }

      const error = (ctx.error instanceof Error)
        ? ctx.error
        : new Error(ctx.message ?? ctx.fullTitle ?? ctx.testName);
      captureException(error);
    });
  }

  private initSentry(): void {
    if (this.initialized) return;
    const dsn = this.options.dsn ?? process.env.SENTRY_DSN;
    if (!dsn) {
      this.enabled = false;
      // eslint-disable-next-line no-console
      console.warn('[vitest-sentry-reporter] SENTRY_DSN missing; reporter disabled');
      return;
    }

    const environment = this.options.environment ?? process.env.SENTRY_ENVIRONMENT ?? inferEnvironment();
    const release = this.options.release ?? process.env.SENTRY_RELEASE ?? commitSha() ?? undefined;

    init({
      dsn,
      environment,
      release,
      integrations: (defaults) => defaults,
      tracesSampleRate: 0,
      ...this.options.sentryOptions,
    });
    this.initialized = true;
  }

  private resolveEnabled(options: VitestSentryReporterOptions): boolean {
    if (typeof options.enabled === 'boolean') return options.enabled;
    return Boolean(options.dsn ?? process.env.SENTRY_DSN);
  }
}

export default VitestSentryReporter;



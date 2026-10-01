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
import {
  type DetectedIdentities,
  type DetectedIdentity,
  detectIdentities,
} from './identity.js';
import type {
  FailureContext,
  Primitive,
  SentryUser,
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

/**
 * The default `getUser`: the pseudonymized id of the developer, else of the
 * latest committer, so a run that a bot triggers still counts the person
 * behind the change. It reads `committer` only when there is no developer,
 * because the first read runs `git log`.
 */
function defaultGetUser(
  _ctx: FailureContext,
  detected: DetectedIdentities,
): SentryUser | undefined {
  const person = detected.developer ?? detected.committer;
  return person ? { id: person.pseudonymizedId } : undefined;
}

/** The detected person that a Sentry user stands for. */
type UserSource = 'developer' | 'committer';

/** True when a field of `user` is a field of `person`. */
function isSamePerson(
  user: SentryUser,
  person: DetectedIdentity | undefined,
): boolean {
  if (!person) return false;
  const known: unknown[] = [
    person.pseudonymizedId,
    person.id,
    person.username,
    person.email,
  ];
  return [user.id, user.username, user.email].some(
    (value) => Boolean(value) && known.includes(value),
  );
}

/** 1.5.0 options that no longer exist, and what replaces each one. */
const REMOVED_OPTIONS: Readonly<Record<string, string>> = {
  identity: 'getUser',
};

/** Sentry needs an id, a username or an email to count a user. */
function isSentryUser(value: unknown): value is SentryUser {
  if (typeof value !== 'object' || value === null) return false;
  const { id, username, email } = value as SentryUser;
  return Boolean(id || username || email);
}

function describeValue(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? 'an object without an id, a username or an email'
    : `a ${typeof value}`;
}

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
  private getUser?: (
    ctx: FailureContext,
    detected: DetectedIdentities,
  ) => SentryUser | undefined;
  private detected?: DetectedIdentities;
  private warned: Set<string>;

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

    // `false` turns identity off. Any other value that is not a function falls
    // back to the default, so an unexpected value never sends more than a
    // pseudonym.
    const getUser = options.getUser;
    this.getUser =
      getUser === false
        ? undefined
        : typeof getUser === 'function'
          ? getUser
          : defaultGetUser;
    this.warned = new Set<string>();

    // A JavaScript config can still carry a 1.5.0 key. Say once that it has
    // no effect, instead of ignoring it silently.
    for (const [key, replacement] of Object.entries(REMOVED_OPTIONS)) {
      if (key in options) {
        console.warn(
          `[vitest-sentry-reporter] The "${key}" option no longer exists and has no effect. Use "${replacement}" instead.`,
        );
      }
    }
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
    // The Sentry user for this failure, and its searchable counterparts.
    const user = this.resolveUser(ctx);
    const identityTags: Record<string, Primitive> = user
      ? {
          triggered_by: user.username || user.id,
          user_source: this.userSource(user),
        }
      : {};
    const mergedTags = {
      ...manualTags,
      ...cleanRecord(baseTags(ctx)),
      ...cleanRecord(codeOwnerTags),
      ...cleanRecord(identityTags),
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
      // Surface CI triage links as a dedicated context so Sentry renders them
      // as clickable links straight to the run, pull request and commit.
      const ci = ciContext();
      if (Object.keys(ci).length > 0) scope.setContext('ci', ci);
      scope.setFingerprint(fingerprint);

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

  /**
   * The user that `getUser` picks for one failure, or `undefined` when
   * `getUser` is `false`, returns nothing, returns a value that is not a
   * Sentry user, or throws. The detection runs once, on the first failure,
   * since the developer behind a run does not change during the run.
   */
  private resolveUser(ctx: FailureContext): SentryUser | undefined {
    if (!this.getUser) return undefined;
    this.detected ??= detectIdentities(process.env);
    let user: unknown;
    try {
      user = this.getUser(ctx, this.detected);
    } catch (error) {
      // A broken callback costs the Sentry user, never the failure event.
      this.warnOnce(
        'getUser threw an error. The reporter sends the failure without a user.',
        error,
      );
      return undefined;
    }
    if (!user) return undefined;
    if (isSentryUser(user)) return user;
    this.warnOnce(
      `getUser returned ${describeValue(user)}, and not a Sentry user with an id, a username or an email. The reporter sends the failure without a user.`,
    );
    return undefined;
  }

  /**
   * Which detected person `user` stands for, for the `user_source` tag. It
   * compares the fields, so it also works for a custom `getUser`.
   */
  private userSource(user: SentryUser): UserSource | undefined {
    if (isSamePerson(user, this.detected?.developer)) return 'developer';
    // Last, because the first read of `committer` runs `git log`.
    if (isSamePerson(user, this.detected?.committer)) return 'committer';
    return undefined;
  }

  /** Log each warning once per run, however many failures trigger it. */
  private warnOnce(message: string, ...details: unknown[]): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(`[vitest-sentry-reporter] ${message}`, ...details);
  }
}

export default VitestSentryReporter;

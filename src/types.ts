import type * as Sentry from '@sentry/node';

export type Primitive = string | number | boolean | null | undefined;

/**
 * Configuration for the Sentry-enabled Vitest reporter.
 *
 * Defaults are chosen to make the reporter work out-of-the-box in CI when `SENTRY_DSN` is set.
 * Most fields can be provided via environment variables and are merged with these options.
 */
export type VitestSentryReporterOptions = {
  /**
   * Sentry DSN. If omitted, `process.env.SENTRY_DSN` is used.
   * Reporter is disabled when no DSN is available.
   */
  dsn?: string;
  /**
   * Force enable/disable the reporter regardless of DSN presence.
   * Defaults to enabled when a DSN is available.
   */
  enabled?: boolean;
  /**
   * Event environment. If omitted, uses `SENTRY_ENVIRONMENT` or falls back to `ci` when a CI is detected,
   * otherwise `process.env.NODE_ENV || 'local'`.
   */
  environment?: string;
  /**
   * Release identifier. If omitted, uses `SENTRY_RELEASE` or commonly available CI commit SHA.
   */
  release?: string;
  /**
   * Optional server name/hostname. If omitted, Sentry SDK defaults apply.
   */
  serverName?: string;
  /**
   * Optional logical project tag you can use to group events across multiple repositories.
   */
  project?: string;
  /**
   * Static tags to attach to every reported failure. Values are coerced to strings.
   */
  tags?: Record<string, Primitive>;
  /**
   * Additional Sentry Node SDK options merged into the initialization call.
   */
  sentryOptions?: Sentry.NodeOptions;
  /**
   * Predicate to determine if a given failure should be reported.
   * Return false to skip reporting.
   */
  shouldReport?: (ctx: FailureContext) => boolean;
  /**
   * Produce dynamic tags per failure. Merged after static `tags`.
   */
  getTags?: (ctx: FailureContext) => Record<string, Primitive> | undefined;
  /**
   * Sentry fingerprint to control grouping. If omitted, defaults to
   * `['vitest-failure', filePath || 'unknown-file', testName]`.
   */
  getFingerprint?: (ctx: FailureContext) => string[] | undefined;
  /**
   * Associate a user with the event (useful for local runs).
   */
  getUser?: (ctx: FailureContext) => { id?: string; email?: string; username?: string } | undefined;
  /**
   * Final event mutation hook, applied via scope event processor before sending.
   * Return the modified event or `null` to drop it.
   */
  beforeSend?: (event: Sentry.Event, hint: Sentry.EventHint, ctx: FailureContext) => Sentry.Event | null;
  /**
   * Upper bound on number of events sent in a single Vitest run. Useful to cap noise in very large suites.
   */
  maxEventsPerRun?: number;
  /**
   * When true, prints what would be sent to Sentry without actually sending events.
   * It has no effect if `enabled` is false.
   */
  dryRun?: boolean;
};

export type FailureContext = {
  id?: string;
  filePath?: string;
  testName: string;
  fullTitle?: string;
  suitePath?: string[];
  message?: string;
  stack?: string;
  error?: unknown;
  durationMs?: number;
  retry?: number;
  flaky?: boolean;
  logs?: string[];
  meta?: Record<string, unknown>;
};

export type VitestTaskState = 'fail' | 'pass' | 'skip' | 'todo' | 'only' | 'run' | 'only-fail';

export interface VitestErrorLike {
  name?: string;
  message?: string;
  stack?: string;
  cause?: unknown;
}

export interface VitestTaskResult {
  state?: VitestTaskState;
  duration?: number;
  retry?: number;
  flaky?: boolean;
  errors?: VitestErrorLike[];
  logs?: string[];
}

export interface VitestFileRef { filepath?: string; name?: string }
export interface VitestLocation { file?: string }
export interface VitestSuiteNode { name?: string; suite?: VitestSuiteNode; parent?: VitestSuiteNode }

export interface VitestTaskLike {
  id?: string | number;
  name?: string;
  fullName?: string;
  suitePath?: string[];
  suite?: VitestSuiteNode;
  parent?: VitestSuiteNode;
  file?: VitestFileRef;
  location?: VitestLocation;
  result?: VitestTaskResult;
  errors?: VitestErrorLike[];
  duration?: number;
  retry?: number;
  meta?: { flaky?: boolean };
  logs?: string[];
  state?: VitestTaskState;
}

export type TaskUpdatePack =
  | [task: VitestTaskLike, result?: VitestTaskResult]
  | { task: VitestTaskLike; result?: VitestTaskResult };

export declare class VitestSentryReporter {
  name: string;
  constructor(options?: VitestSentryReporterOptions);
  onInit(): void;
  onTaskUpdate(packs: TaskUpdatePack[]): void;
  onFinished(files?: { tasks?: VitestTaskLike[] }[]): void;
}
export default VitestSentryReporter;

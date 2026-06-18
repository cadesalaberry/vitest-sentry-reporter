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
  getUser?: (
    ctx: FailureContext,
  ) => { id?: string; email?: string; username?: string } | undefined;
  /**
   * Final event mutation hook, applied via scope event processor before sending.
   * Return the modified event or `null` to drop it.
   */
  beforeSend?: (
    event: Sentry.Event,
    hint: Sentry.EventHint,
    ctx: FailureContext,
  ) => Sentry.Event | null;
  /**
   * Resolve repository CODEOWNERS for each failing test file and attach
   * `code_owners` (all matching owners, comma-joined) and `code_owner` (the
   * primary/first owner) Sentry tags, plus a `code_owners` array in extras.
   *
   * Disabled by default. Set `true` to enable with an auto-detected repository
   * root (CI checkout path when available, otherwise `process.cwd()`), or pass
   * an object to override the root used to locate the CODEOWNERS file and
   * relativize test paths. Both tags can be overridden via `tags`/`getTags`.
   */
  codeowners?: boolean | { enabled?: boolean; root?: string };
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
  /**
   * {@link filePath} made relative to the repository root (POSIX separators), so
   * the same failure groups identically across local and CI checkouts whose
   * absolute paths differ. Falls back to the absolute path when it cannot be
   * relativized. Used for the `test_file` tag and the default fingerprint.
   */
  relativeFilePath?: string;
  testName: string;
  fullTitle?: string;
  suitePath?: string[];
  message?: string;
  stack?: string;
  error?: unknown;
  /** Test duration in whole milliseconds (rounded to the nearest integer). */
  durationMs?: number;
  retry?: number;
  flaky?: boolean;
  logs?: string[];
  meta?: Record<string, unknown>;
};

/**
 * Minimal shape of Vitest's `UserConsoleLog`, delivered to the reporter's
 * `onUserConsoleLog` hook. We only depend on the fields we actually use so the
 * reporter does not couple to Vitest internals beyond the public reporter API.
 */
export interface VitestUserConsoleLog {
  content: string;
  type: 'stdout' | 'stderr';
  taskId?: string;
}

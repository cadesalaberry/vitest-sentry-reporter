import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import { detectActor } from './actor-detectors/index.js';
import { detectProvider } from './ci-providers/index.js';
import type { SentryUser } from './types.js';

/**
 * One detected developer. The `id` is always a pseudonym and never a raw
 * account id, so the `id` alone carries no personal data.
 */
export type DetectedIdentity = {
  /** Stable, opaque pseudonym: `dev-` and 16 hex characters of a SHA-256 digest. */
  id: string;
  /** The login or the display name, when the source exposes one. Personal data. */
  username?: string;
  /** The email address, when the source exposes one. Personal data. */
  email?: string;
};

/** The developers that the reporter detects for the current run. */
export type DetectedIdentities = {
  /** Who triggered the CI run, per provider. Absent outside CI. */
  ci?: DetectedIdentity;
  /**
   * The author of the last non-merge commit, else `git config user.*`, else
   * the OS username.
   */
  commitAuthor?: DetectedIdentity;
};

/**
 * Detect the developers behind the current test run, for the `identify`
 * option. Each candidate gets a pseudonymous `id`, seeded by its email, then
 * its CI account id, then its username.
 *
 * `ci` comes from the CI provider (see {@link detectProvider}).
 * `commitAuthor` comes from the last commit's git author, then `git config
 * user.name` / `user.email`, then the OS username.
 *
 * Automation bots and AI agents are excluded up front, so they never inflate
 * the developer count. A candidate is absent when nothing usable resolves.
 */
export function detectIdentities(
  env: NodeJS.ProcessEnv = process.env,
): DetectedIdentities {
  // Never attribute a failing run to a bot or an AI agent.
  if (detectActor(env).type !== 'human') return {};

  const identities: DetectedIdentities = {};
  const ci = toDetectedIdentity(triggeredByCI(env));
  if (ci) identities.ci = ci;
  const commitAuthor = toDetectedIdentity(
    gitAuthor(env) ?? gitConfigUser() ?? osUser(),
  );
  if (commitAuthor) identities.commitAuthor = commitAuthor;
  return identities;
}

function triggeredByCI(env: NodeJS.ProcessEnv): SentryUser | undefined {
  return cleanUser(detectProvider(env)?.triggeredBy(env));
}

function gitAuthor(env: NodeJS.ProcessEnv): SentryUser | undefined {
  // Skip the git author when not on a real commit (e.g. a fresh, commitless
  // checkout); %an/%ae are separated by a unit separator to survive odd names.
  const out = git(env, ['log', '-1', '--no-merges', '--format=%an%x1f%ae']);
  if (!out) return undefined;
  const [username, email] = out.split('\x1f');
  return cleanUser({ username, email });
}

function gitConfigUser(): SentryUser | undefined {
  return cleanUser({
    username: git(process.env, ['config', '--get', 'user.name']),
    email: git(process.env, ['config', '--get', 'user.email']),
  });
}

function osUser(): SentryUser | undefined {
  try {
    return cleanUser({ username: os.userInfo().username });
  } catch {
    // os.userInfo throws when there is no mapped OS user (e.g. some sandboxes).
    return undefined;
  }
}

/** Run git and return trimmed stdout, or `undefined` if git is absent or fails. */
function git(env: NodeJS.ProcessEnv, args: string[]): string | undefined {
  try {
    const out = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      env,
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** Marks an id as a derived pseudonym and not a real account id. */
const PSEUDONYM_PREFIX = 'dev-';
/** Digest characters kept: 64 bits, which does not collide at team scale. */
const PSEUDONYM_LENGTH = 16;

/**
 * Replace the raw id with a pseudonym, and keep the readable fields for the
 * `identify` callback.
 *
 * The seed is the most stable identifier available: the email, then the CI
 * account id, then the username. The seed is trimmed and lowercased, so the
 * same developer always gets the same pseudonym. The digest is reproducible: a
 * maintainer who knows the team emails can map a pseudonym back offline.
 */
function toDetectedIdentity(
  user: SentryUser | undefined,
): DetectedIdentity | undefined {
  const seed = user?.email ?? user?.id ?? user?.username;
  if (!seed) return undefined;
  const digest = sha256(seed.trim().toLowerCase()).slice(0, PSEUDONYM_LENGTH);
  const identity: DetectedIdentity = { id: `${PSEUDONYM_PREFIX}${digest}` };
  if (user?.username) identity.username = user.username;
  if (user?.email) identity.email = user.email;
  return identity;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Drop undefined/empty fields; return `undefined` when nothing remains. */
function cleanUser(user: SentryUser | undefined): SentryUser | undefined {
  if (!user) return undefined;
  const out: SentryUser = {};
  if (user.id) out.id = user.id;
  if (user.username) out.username = user.username;
  if (user.email) out.email = user.email;
  return Object.keys(out).length > 0 ? out : undefined;
}

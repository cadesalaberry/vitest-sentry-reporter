import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import { detectActor } from './actor-detectors/index.js';
import { detectProvider } from './ci-providers/index.js';
import type { SentryUser } from './types.js';

/**
 * One detected developer. The `id` is always a pseudonym and never a raw
 * account id. It carries no name and no email, but it is pseudonymous
 * personal data: anybody who knows the seed can compute the same id.
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
  /**
   * The developer who ran the tests. In CI, the person who triggered the run.
   * Outside CI, `git config user.*`, else the OS user. Absent for automation
   * bots and AI agents, and in a CI that exposes no trigger-er.
   */
  developer?: DetectedIdentity;
};

/**
 * Detect the developer who ran the tests, for the `identify` option. The
 * developer gets a pseudonymous `id`, seeded by the email, else the username,
 * else the CI account id.
 *
 * In CI, the developer is the person who triggered the run (see
 * {@link detectProvider}), and no git command runs. Outside CI, the developer
 * is `git config user.email` / `user.name`, else the OS username. The commit
 * history is never read, so the result does not depend on the checkout depth
 * or on the author of the last commit.
 *
 * Automation bots and AI agents are excluded up front, so they never inflate
 * the developer count. `developer` is absent when nothing usable resolves.
 */
export function detectIdentities(
  env: NodeJS.ProcessEnv = process.env,
): DetectedIdentities {
  // Never attribute a failing run to a bot or an AI agent.
  if (detectActor(env).type !== 'human') return {};

  // In CI, the git user and the OS user belong to the machine and not to a
  // developer, so a CI that exposes no trigger-er yields no developer.
  const provider = detectProvider(env);
  const user = provider
    ? cleanUser(provider.triggeredBy(env))
    : (gitConfigUser(env) ?? osUser());
  const developer = toDetectedIdentity(user);
  return developer ? { developer } : {};
}

function gitConfigUser(env: NodeJS.ProcessEnv): SentryUser | undefined {
  return cleanUser({
    username: git(env, ['config', '--get', 'user.name']),
    email: git(env, ['config', '--get', 'user.email']),
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
 * The seed is the email, else the username, else the CI account id. The
 * username comes before the account id because GitHub exposes the id of
 * `GITHUB_ACTOR` only: on a re-run by another person, the trigger-er has a
 * login and no id. A login seed gives one account one pseudonym in every run.
 * The seed is trimmed and lowercased. The digest is not salted, so anybody who
 * knows the seed can compute the same pseudonym offline.
 */
function toDetectedIdentity(
  user: SentryUser | undefined,
): DetectedIdentity | undefined {
  const seed = user?.email ?? user?.username ?? user?.id;
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

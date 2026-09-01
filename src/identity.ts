import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import { detectActor } from './actor-detectors/index.js';
import { detectProvider } from './ci-providers/index.js';
import type { SentryUser } from './types.js';

/** Which signals {@link detectIdentity} may use. */
export type IdentitySource = 'ci' | 'commit-author' | 'both';

export type IdentityOptions = {
  /**
   * `'ci'` = the CI trigger-er only; `'commit-author'` = git author / config /
   * OS user only; `'both'` = the full chain (default).
   */
  source?: IdentitySource;
  /** Include the email in the returned user. Email is PII; defaults to `false`. */
  includeEmail?: boolean;
  /** SHA-256 the id and email before returning them. Defaults to `false`. */
  hash?: boolean;
  /**
   * Replace the identity with a stable, opaque id and drop the name and the
   * email. The id stays the same for the same developer across runs, so Sentry
   * still counts distinct developers. Defaults to `false`. This option takes
   * precedence over {@link includeEmail} and {@link hash}.
   */
  pseudonymise?: boolean;
};

/**
 * Best-effort identity of the developer who triggered the current test run, for
 * Sentry's `scope.setUser` (which powers the "users affected" metric).
 *
 * Resolution is a priority-ordered fallback chain:
 *   1. the CI run's trigger-er (per {@link detectProvider}),
 *   2. the last commit's git author,
 *   3. `git config user.name` / `user.email`,
 *   4. the OS username.
 *
 * Automation bots and AI agents are excluded up front so they never inflate the
 * developer count. Returns `undefined` when nothing usable can be resolved.
 */
export function detectIdentity(
  env: NodeJS.ProcessEnv = process.env,
  options: IdentityOptions = {},
): SentryUser | undefined {
  // Never attribute a failing run to a bot or an AI agent.
  if (detectActor(env).type !== 'human') return undefined;

  const source = options.source ?? 'both';
  let raw: SentryUser | undefined;
  if (source !== 'commit-author') raw = triggeredByCI(env);
  if (!raw && source !== 'ci') {
    raw = gitAuthor(env) ?? gitConfigUser() ?? osUser();
  }

  return finalizeUser(raw, options);
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

/** Apply the pseudonymise/email/hash options, then drop empty fields. */
function finalizeUser(
  user: SentryUser | undefined,
  options: IdentityOptions,
): SentryUser | undefined {
  if (!user) return undefined;
  // A pseudonym replaces the whole identity, so the other options do not apply.
  if (options.pseudonymise) return pseudonymousUser(user);
  let { id, username, email } = user;
  if (!options.includeEmail) email = undefined;
  if (options.hash) {
    // Hash the identifying id/email; the username stays readable, as it is the
    // searchable handle and not sensitive on its own.
    id = id ? sha256(id) : id;
    email = email ? sha256(email) : email;
  }
  return cleanUser({ id, username, email });
}

/** Marks an id as a derived pseudonym and not a real account id. */
const PSEUDONYM_PREFIX = 'dev-';
/** Digest characters kept: 64 bits, which does not collide at team scale. */
const PSEUDONYM_LENGTH = 16;

/**
 * One opaque id and nothing else, so Sentry can count distinct developers
 * without a name or an email.
 *
 * The seed is the most stable identifier available: the email, then the CI
 * account id, then the username. The seed is lowercased, so the same developer
 * always gets the same pseudonym. The digest is reproducible: a maintainer who
 * knows the team emails can map a pseudonym back to a person offline.
 */
function pseudonymousUser(user: SentryUser): SentryUser | undefined {
  const seed = user.email ?? user.id ?? user.username;
  if (!seed) return undefined;
  const digest = sha256(seed.trim().toLowerCase()).slice(0, PSEUDONYM_LENGTH);
  return { id: `${PSEUDONYM_PREFIX}${digest}` };
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

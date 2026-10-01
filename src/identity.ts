import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import { ACTOR_DETECTORS, detectActor } from './actor-detectors/index.js';
import { detectProvider } from './ci-providers/index.js';
import type { SentryUser } from './types.js';

/**
 * One detected person, with the fields that the source exposes. `id`,
 * `username` and `email` are personal data. `pseudonymizedId` carries no name
 * and no email, but it is still pseudonymous personal data.
 */
export type DetectedIdentity = {
  /** The account id, when the source exposes one (for example a CI account). */
  id?: string;
  /** The login or the display name, when the source exposes one. */
  username?: string;
  /** The email address, when the source exposes one. */
  email?: string;
  /**
   * `dev-` and 16 hex characters of the SHA-256 digest of the email, else the
   * username, else the account id, trimmed and lowercased.
   */
  pseudonymizedId: string;
};

/** The people that the reporter detects for the current run. */
export type DetectedIdentities = {
  /**
   * The person who ran the tests: in CI, the account that triggered the run,
   * and outside CI, `git config user.*`, else the OS user. Absent when a bot
   * or an AI agent runs the tests.
   */
  developer?: DetectedIdentity;
  /**
   * The person behind the latest commit (`HEAD`): its committer, else its
   * author. GitHub, bots and AI agents do not count, so the field is
   * `undefined` when only they remain. The first read runs `git log -1` in
   * the current directory.
   */
  committer?: DetectedIdentity;
};

/**
 * Detect the people behind the current test run, for the `getUser` option.
 *
 * `developer` comes from the CI provider in CI (see {@link detectProvider}),
 * and from `git config`, else the OS user, outside CI. `committer` comes from
 * the `HEAD` commit, on its first read. Each one is `undefined` when nothing
 * usable resolves.
 */
export function detectIdentities(
  env: NodeJS.ProcessEnv = process.env,
): DetectedIdentities {
  const identities: DetectedIdentities = {};
  // Never attribute a run to the bot or the AI agent that runs it.
  if (detectActor(env).type === 'human') {
    const person = runner(env);
    if (person && !isAutomation(person)) {
      identities.developer = toDetectedIdentity(person);
    }
  }
  // Run `git log` only if a caller reads the committer, and only once.
  Object.defineProperty(identities, 'committer', {
    enumerable: true,
    get: once(() => toDetectedIdentity(latestCommitter(env))),
  });
  return identities;
}

/** Call `fn` on the first call only, and return its result on every call. */
function once<T>(fn: () => T): () => T {
  let result: { value: T } | undefined;
  return () => {
    result ??= { value: fn() };
    return result.value;
  };
}

function runner(env: NodeJS.ProcessEnv): SentryUser | undefined {
  // In CI, the git user and the OS user belong to the machine and not to a
  // developer, so a CI that exposes no trigger-er yields no developer.
  const provider = detectProvider(env);
  return provider
    ? cleanUser(provider.triggeredBy(env))
    : (gitConfigUser(env) ?? osUser());
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

function latestCommitter(env: NodeJS.ProcessEnv): SentryUser | undefined {
  // HEAD carries its own metadata even in a depth-1 clone, so the result does
  // not depend on the checkout depth. A unit separator splits the fields.
  const out = git(env, ['log', '-1', '--format=%cn%x1f%ce%x1f%an%x1f%ae']);
  if (!out) return undefined;
  const [committerName, committerEmail, authorName, authorEmail] =
    out.split('\x1f');
  // GitHub is the committer of every commit merged on github.com, so the
  // author stands in for it.
  return [
    cleanUser({ username: committerName, email: committerEmail }),
    cleanUser({ username: authorName, email: authorEmail }),
  ].find((person) => person && !isAutomation(person));
}

/** GitHub commits the merges made on github.com with this address. */
const GITHUB_MERGE_EMAIL = 'noreply@github.com';

/**
 * GitHub, a GitHub App bot such as `dependabot[bot]`, or an agent of
 * {@link ACTOR_DETECTORS} by its commit email. Add a new agent there.
 */
function isAutomation({ username, email }: SentryUser): boolean {
  if (/\[bot\]/.test(`${username ?? ''} ${email ?? ''}`)) return true;
  if (!email) return false;
  if (email.toLowerCase() === GITHUB_MERGE_EMAIL) return true;
  return ACTOR_DETECTORS.some((actor) => actor.commitEmail?.test(email));
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
 * Keep the detected fields, and add the pseudonymized id. The seed is the
 * email, else the username, else the account id: the email is the most stable
 * identifier of one person across machines, and on GitHub Actions the login is
 * present in every run. The seed is trimmed and lowercased, so one seed always
 * gives one pseudonymized id. The digest is not salted, so anybody who knows
 * the seed can compute the same id offline.
 */
function toDetectedIdentity(
  user: SentryUser | undefined,
): DetectedIdentity | undefined {
  const seed = user?.email ?? user?.username ?? user?.id;
  if (!seed) return undefined;
  const digest = sha256(seed.trim().toLowerCase()).slice(0, PSEUDONYM_LENGTH);
  return { ...user, pseudonymizedId: `${PSEUDONYM_PREFIX}${digest}` };
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

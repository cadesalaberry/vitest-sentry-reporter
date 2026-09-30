import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the OS, git and detection collaborators so the fallback chain is fully
// deterministic and never shells out to a real git during the test run.
const cp = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => cp);

const osMock = vi.hoisted(() => ({
  userInfo: vi.fn(() => ({ username: 'os-user' })),
}));
vi.mock('node:os', () => osMock);

const actor = vi.hoisted(() => ({
  detectActor: vi.fn(() => ({ type: 'human', name: 'human' })),
}));
vi.mock('./actor-detectors/index.js', () => actor);

const ci = vi.hoisted(() => ({ detectProvider: vi.fn(() => undefined) }));
vi.mock('./ci-providers/index.js', () => ci);

import { detectIdentities } from './identity.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
/** The pseudonymized id of a seed that is already trimmed and lowercased. */
const pseudonym = (seed: string) => `dev-${sha256(seed).slice(0, 16)}`;

type Person = { name: string; email: string };
const JANE: Person = { name: 'Jane Dev', email: 'jane@acme.test' };
const GITHUB: Person = { name: 'GitHub', email: 'noreply@github.com' };

/** Drive the mocked git: `git config` and the `HEAD` committer and author. */
function gitReturns(map: {
  name?: string;
  email?: string;
  committer?: Person;
  author?: Person;
}) {
  cp.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
    if (args[0] === 'config' && args[2] === 'user.name') return map.name ?? '';
    if (args[0] === 'config' && args[2] === 'user.email')
      return map.email ?? '';
    if (args[0] === 'log') {
      const { committer, author = committer } = map;
      if (!committer || !author) return '';
      return [committer.name, committer.email, author.name, author.email].join(
        '\x1f',
      );
    }
    return '';
  });
}

/** Simulate a CI provider whose trigger-er is `user`. */
function inCI(
  user: { id?: string; email?: string; username?: string } | undefined,
) {
  ci.detectProvider.mockReturnValue({ triggeredBy: () => user });
}

describe('detectIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor.detectActor.mockReturnValue({ type: 'human', name: 'human' });
    ci.detectProvider.mockReturnValue(undefined);
    cp.execFileSync.mockReturnValue('');
    osMock.userInfo.mockReturnValue({ username: 'os-user' });
  });

  it('keeps the detected fields and adds the pseudonymized id', () => {
    inCI({ username: 'alice', id: '42' });

    expect(detectIdentities({}).developer).toEqual({
      id: '42',
      username: 'alice',
      pseudonymizedId: pseudonym('alice'),
    });
  });

  it('seeds the pseudonymized id by the email, then the username, then the id', () => {
    inCI({ id: '42', username: 'alice', email: 'a@acme.test' });
    expect(detectIdentities({}).developer?.pseudonymizedId).toBe(
      pseudonym('a@acme.test'),
    );

    inCI({ id: '42', username: 'alice' });
    expect(detectIdentities({}).developer?.pseudonymizedId).toBe(
      pseudonym('alice'),
    );

    inCI({ id: '42' });
    expect(detectIdentities({}).developer?.pseudonymizedId).toBe(
      pseudonym('42'),
    );
  });

  it('gives one person one pseudonymized id, and two people two', () => {
    gitReturns({ name: 'Jane', email: '  Jane@Acme.test ' });
    const first = detectIdentities({}).developer?.pseudonymizedId;

    gitReturns({ name: 'Jane', email: 'jane@acme.test' });
    expect(detectIdentities({}).developer?.pseudonymizedId).toBe(first);

    gitReturns({ name: 'Bob', email: 'bob@acme.test' });
    expect(detectIdentities({}).developer?.pseudonymizedId).not.toBe(first);
  });

  it('gives a developer and a committer with one email one pseudonymized id', () => {
    gitReturns({ name: JANE.name, email: JANE.email, committer: JANE });
    const { developer, committer } = detectIdentities({});
    expect(developer?.pseudonymizedId).toBe(committer?.pseudonymizedId);
  });

  it('picks the CI trigger-er as the developer in CI', () => {
    inCI({ username: 'alice', id: '42' });
    gitReturns({ name: 'CI Machine', email: 'ci@acme.test' });

    expect(detectIdentities({}).developer?.username).toBe('alice');
    // The git user of a CI machine is never asked for.
    const commands = cp.execFileSync.mock.calls.map(([, args]) => args);
    expect(commands).not.toContainEqual(['config', '--get', 'user.email']);
  });

  it('detects no developer in a CI that exposes no trigger-er', () => {
    inCI(undefined);
    gitReturns({ name: 'CI Machine', email: 'ci@acme.test' });
    expect(detectIdentities({})).not.toHaveProperty('developer');

    inCI({ username: '' });
    expect(detectIdentities({})).not.toHaveProperty('developer');
    expect(osMock.userInfo).not.toHaveBeenCalled();
  });

  it('picks the git user as the developer outside CI', () => {
    gitReturns({ name: JANE.name, email: JANE.email });
    const env = { HOME: '/home/jane' };

    expect(detectIdentities(env).developer).toEqual({
      username: JANE.name,
      email: JANE.email,
      pseudonymizedId: pseudonym(JANE.email),
    });
    // git runs with the given environment, so that its config resolves there.
    expect(cp.execFileSync).toHaveBeenCalledWith(
      'git',
      ['config', '--get', 'user.email'],
      expect.objectContaining({ env }),
    );
  });

  it('detects no developer when the git user is a bot or an AI agent', () => {
    // For example a sandbox that commits as the agent, with no AI marker set.
    gitReturns({ name: 'Claude', email: 'noreply@anthropic.com' });
    expect(detectIdentities({})).not.toHaveProperty('developer');

    inCI({ username: 'renovate[bot]' });
    expect(detectIdentities({})).not.toHaveProperty('developer');
  });

  it('falls back to the OS username when git has no user', () => {
    gitReturns({});
    expect(detectIdentities({}).developer).toEqual({
      username: 'os-user',
      pseudonymizedId: pseudonym('os-user'),
    });
  });

  it('detects no developer for a bot or an AI agent, but still the committer', () => {
    gitReturns({ committer: JANE });

    for (const type of ['bot', 'ai']) {
      actor.detectActor.mockReturnValue({ type, name: type });
      inCI({ username: 'should-not-be-used' });

      expect(detectIdentities({})).toEqual({
        committer: {
          username: JANE.name,
          email: JANE.email,
          pseudonymizedId: pseudonym(JANE.email),
        },
      });
    }
  });

  it('reads only the HEAD commit for the committer, not the history', () => {
    gitReturns({ committer: JANE });
    detectIdentities({});

    const log = cp.execFileSync.mock.calls
      .map(([, args]) => args as string[])
      .filter((args) => args[0] === 'log');
    expect(log).toEqual([['log', '-1', '--format=%cn%x1f%ce%x1f%an%x1f%ae']]);
  });

  it('uses the author when GitHub is the committer', () => {
    gitReturns({ committer: GITHUB, author: JANE });
    expect(detectIdentities({}).committer?.email).toBe(JANE.email);
  });

  it('detects no committer for GitHub, a bot or an AI agent', () => {
    const release: Person = {
      name: 'github-actions[bot]',
      email: '41898282+github-actions[bot]@users.noreply.github.com',
    };
    const agent: Person = { name: 'Claude', email: 'noreply@anthropic.com' };

    for (const author of [release, agent, GITHUB]) {
      gitReturns({ committer: GITHUB, author });
      expect(detectIdentities({})).not.toHaveProperty('committer');
    }
  });

  it('detects nothing when git is absent and there is no OS user', () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('ENOENT: git not found');
    });
    osMock.userInfo.mockImplementation(() => {
      throw new Error('no mapped user');
    });
    expect(detectIdentities({})).toEqual({});
  });
});

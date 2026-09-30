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
const pseudonym = (v: string) => `dev-${sha256(v).slice(0, 16)}`;

/** Drive the mocked git so `git config` returns canned output. */
function gitConfigReturns(map: { name?: string; email?: string }) {
  cp.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
    if (args[0] === 'config' && args[2] === 'user.name') return map.name ?? '';
    if (args[0] === 'config' && args[2] === 'user.email')
      return map.email ?? '';
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

  it('detects nothing and skips detection for a bot', () => {
    actor.detectActor.mockReturnValue({ type: 'bot', name: 'dependabot' });
    inCI({ username: 'should-not-be-used' });

    expect(detectIdentities({})).toEqual({});
    expect(ci.detectProvider).not.toHaveBeenCalled();
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('detects nothing for an AI agent', () => {
    actor.detectActor.mockReturnValue({ type: 'ai', name: 'claude-code' });
    gitConfigReturns({ name: 'Jane Dev', email: 'jane@acme.test' });

    expect(detectIdentities({})).toEqual({});
  });

  it('picks the CI trigger-er in CI, and runs no git command', () => {
    inCI({ username: 'alice', id: '42' });
    gitConfigReturns({ name: 'CI Machine', email: 'ci@acme.test' });

    expect(detectIdentities({})).toEqual({
      developer: { id: pseudonym('alice'), username: 'alice' },
    });
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('detects no developer in a CI that exposes no trigger-er', () => {
    // The git user and the OS user of a CI machine are not a developer.
    inCI(undefined);
    gitConfigReturns({ name: 'CI Machine', email: 'ci@acme.test' });
    expect(detectIdentities({})).toEqual({});

    inCI({ username: '' });
    expect(detectIdentities({})).toEqual({});
    expect(cp.execFileSync).not.toHaveBeenCalled();
    expect(osMock.userInfo).not.toHaveBeenCalled();
  });

  it('picks the git user outside CI', () => {
    gitConfigReturns({ name: 'Jane Dev', email: 'jane@acme.test' });
    const env = { HOME: '/home/jane' };

    expect(detectIdentities(env)).toEqual({
      developer: {
        id: pseudonym('jane@acme.test'),
        username: 'Jane Dev',
        email: 'jane@acme.test',
      },
    });
    // git runs with the given environment, so that its config resolves there.
    expect(cp.execFileSync).toHaveBeenCalledWith(
      'git',
      ['config', '--get', 'user.email'],
      expect.objectContaining({ env }),
    );
  });

  it('never reads the commit history', () => {
    gitConfigReturns({ name: 'Jane Dev', email: 'jane@acme.test' });
    detectIdentities({});

    const commands = cp.execFileSync.mock.calls.map(
      ([, args]) => (args as string[])[0],
    );
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((command) => command === 'config')).toBe(true);
  });

  it('falls back to the OS username when git has no user', () => {
    gitConfigReturns({});
    expect(detectIdentities({})).toEqual({
      developer: { id: pseudonym('os-user'), username: 'os-user' },
    });
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

  it('never exposes the raw CI account id', () => {
    inCI({ id: '42' });
    const { developer } = detectIdentities({});

    expect(developer?.id).toMatch(/^dev-[0-9a-f]{16}$/);
    expect(JSON.stringify(developer)).not.toContain('"42"');
  });

  it('seeds the pseudonym from the email, then the username, then the account id', () => {
    inCI({ username: 'alice', id: '42', email: 'a@acme.test' });
    expect(detectIdentities({}).developer?.id).toBe(pseudonym('a@acme.test'));

    inCI({ username: 'alice', id: '42' });
    expect(detectIdentities({}).developer?.id).toBe(pseudonym('alice'));

    inCI({ id: '42' });
    expect(detectIdentities({}).developer?.id).toBe(pseudonym('42'));
  });

  it('gives one GitHub account one pseudonym, with or without its account id', () => {
    // A first run carries the account id; a re-run of another person's run
    // carries the login only. Both must count as the same developer.
    inCI({ username: 'alice', id: '42' });
    const firstRun = detectIdentities({}).developer?.id;

    inCI({ username: 'alice' });
    expect(detectIdentities({}).developer?.id).toBe(firstRun);
  });

  it('gives the same pseudonym to the same developer, and only to them', () => {
    gitConfigReturns({ name: 'Jane', email: '  Jane@Acme.test ' });
    const first = detectIdentities({}).developer?.id;

    gitConfigReturns({ name: 'Jane', email: 'jane@acme.test' });
    expect(detectIdentities({}).developer?.id).toBe(first);

    gitConfigReturns({ name: 'Bob', email: 'bob@acme.test' });
    expect(detectIdentities({}).developer?.id).not.toBe(first);
  });
});

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

/** Drive the mocked git so `git log` and `git config` return canned output. */
function gitReturns(map: { log?: string; name?: string; email?: string }) {
  cp.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
    if (args[0] === 'log') return map.log ?? '';
    if (args[0] === 'config' && args[2] === 'user.name') return map.name ?? '';
    if (args[0] === 'config' && args[2] === 'user.email')
      return map.email ?? '';
    return '';
  });
}

function providerTriggeredBy(
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
    providerTriggeredBy({ username: 'should-not-be-used' });

    expect(detectIdentities({})).toEqual({});
    expect(ci.detectProvider).not.toHaveBeenCalled();
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('detects nothing for an AI agent', () => {
    actor.detectActor.mockReturnValue({ type: 'ai', name: 'claude-code' });
    expect(detectIdentities({})).toEqual({});
  });

  it('detects the CI trigger-er and the commit author side by side', () => {
    providerTriggeredBy({ username: 'alice', id: '42' });
    gitReturns({ log: 'Jane Dev\x1fjane@acme.test' });

    expect(detectIdentities({})).toEqual({
      ci: { id: pseudonym('42'), username: 'alice' },
      commitAuthor: {
        id: pseudonym('jane@acme.test'),
        username: 'Jane Dev',
        email: 'jane@acme.test',
      },
    });
  });

  it('never exposes the raw CI account id', () => {
    providerTriggeredBy({ username: 'alice', id: '42' });
    const { ci: trigger } = detectIdentities({});

    expect(trigger?.id).toMatch(/^dev-[0-9a-f]{16}$/);
    expect(JSON.stringify(trigger)).not.toContain('"42"');
  });

  it('seeds the pseudonym from the email, then the account id, then the username', () => {
    providerTriggeredBy({ username: 'alice', id: '42', email: 'a@acme.test' });
    expect(detectIdentities({}).ci?.id).toBe(pseudonym('a@acme.test'));

    providerTriggeredBy({ username: 'alice', id: '42' });
    expect(detectIdentities({}).ci?.id).toBe(pseudonym('42'));

    providerTriggeredBy({ username: 'alice' });
    expect(detectIdentities({}).ci?.id).toBe(pseudonym('alice'));
  });

  it('gives the same pseudonym to the same developer, and only to them', () => {
    gitReturns({ log: 'Jane\x1f  Jane@Acme.test ' });
    const first = detectIdentities({}).commitAuthor?.id;

    gitReturns({ log: 'Jane\x1fjane@acme.test' });
    expect(detectIdentities({}).commitAuthor?.id).toBe(first);

    gitReturns({ log: 'Bob\x1fbob@acme.test' });
    expect(detectIdentities({}).commitAuthor?.id).not.toBe(first);
  });

  it('falls back to git config when there is no commit', () => {
    gitReturns({ log: '', name: 'cfg-user', email: 'cfg@acme.test' });
    expect(detectIdentities({}).commitAuthor).toEqual({
      id: pseudonym('cfg@acme.test'),
      username: 'cfg-user',
      email: 'cfg@acme.test',
    });
  });

  it('falls back to the OS username as a last resort', () => {
    gitReturns({ log: '', name: '', email: '' });
    expect(detectIdentities({}).commitAuthor).toEqual({
      id: pseudonym('os-user'),
      username: 'os-user',
    });
  });

  it('leaves ci absent outside CI and for an empty provider identity', () => {
    gitReturns({ log: 'Jane Dev\x1fjane@acme.test' });
    expect(detectIdentities({})).not.toHaveProperty('ci');

    providerTriggeredBy({ username: '' });
    expect(detectIdentities({})).not.toHaveProperty('ci');
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

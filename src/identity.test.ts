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

import { detectIdentity } from './identity.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

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

describe('detectIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor.detectActor.mockReturnValue({ type: 'human', name: 'human' });
    ci.detectProvider.mockReturnValue(undefined);
    cp.execFileSync.mockReturnValue('');
    osMock.userInfo.mockReturnValue({ username: 'os-user' });
  });

  it('returns nothing and skips detection for a bot', () => {
    actor.detectActor.mockReturnValue({ type: 'bot', name: 'dependabot' });
    providerTriggeredBy({ username: 'should-not-be-used' });

    expect(detectIdentity({})).toBeUndefined();
    expect(ci.detectProvider).not.toHaveBeenCalled();
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('returns nothing for an AI agent', () => {
    actor.detectActor.mockReturnValue({ type: 'ai', name: 'claude-code' });
    expect(detectIdentity({})).toBeUndefined();
  });

  it('prefers the CI trigger-er over git and never shells out', () => {
    providerTriggeredBy({ username: 'alice', id: '42' });
    gitReturns({ log: 'Jane Dev\x1fjane@acme.test' });

    expect(detectIdentity({})).toEqual({ username: 'alice', id: '42' });
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('falls back to the git author when no CI trigger-er, honoring includeEmail', () => {
    gitReturns({ log: 'Jane Dev\x1fjane@acme.test' });

    expect(detectIdentity({})).toEqual({ username: 'Jane Dev' });
    expect(detectIdentity({}, { includeEmail: true })).toEqual({
      username: 'Jane Dev',
      email: 'jane@acme.test',
    });
  });

  it('falls back to git config when there is no commit', () => {
    gitReturns({ log: '', name: 'cfg-user', email: 'cfg@acme.test' });
    expect(detectIdentity({})).toEqual({ username: 'cfg-user' });
  });

  it('falls back to the OS username as a last resort', () => {
    gitReturns({ log: '', name: '', email: '' });
    expect(detectIdentity({})).toEqual({ username: 'os-user' });
  });

  it('ignores an empty provider identity and continues down the chain', () => {
    providerTriggeredBy({ username: '' });
    gitReturns({ log: 'Jane Dev\x1fjane@acme.test' });
    expect(detectIdentity({})).toEqual({ username: 'Jane Dev' });
  });

  it("source 'ci' uses only the trigger-er and never touches git", () => {
    gitReturns({ log: 'Jane Dev\x1fjane@acme.test' });
    expect(detectIdentity({}, { source: 'ci' })).toBeUndefined();
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it("source 'commit-author' ignores the CI trigger-er", () => {
    providerTriggeredBy({ username: 'alice' });
    gitReturns({ log: 'Jane Dev\x1fjane@acme.test' });
    expect(detectIdentity({}, { source: 'commit-author' })).toEqual({
      username: 'Jane Dev',
    });
  });

  it('hashes the id and email but leaves the username readable', () => {
    providerTriggeredBy({
      username: 'alice',
      id: '42',
      email: 'alice@acme.test',
    });
    expect(detectIdentity({}, { includeEmail: true, hash: true })).toEqual({
      username: 'alice',
      id: sha256('42'),
      email: sha256('alice@acme.test'),
    });
  });

  it('returns undefined when git is absent and there is no OS user', () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('ENOENT: git not found');
    });
    osMock.userInfo.mockImplementation(() => {
      throw new Error('no mapped user');
    });
    expect(detectIdentity({})).toBeUndefined();
  });
});

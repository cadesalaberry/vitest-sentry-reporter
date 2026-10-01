import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectIdentities } from './identity.js';

// Real git, no mocks. The fixture is a pull request merge ref, as GitHub
// Actions checks it out: the base branch ends with a release bot commit, the
// pull request adds an AI agent commit, and a synthetic merge commit joins
// them, with GitHub as its committer. It is cloned shallow (the
// `actions/checkout` default) and in full.

type Person = { name: string; email: string };

const MAINTAINER: Person = {
  name: 'Maintainer',
  email: 'maintainer@acme.test',
};
const RELEASE_BOT: Person = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};
const AI_AGENT: Person = { name: 'Claude', email: 'noreply@anthropic.com' };
const PR_OPENER: Person = { name: 'Pat Opener', email: 'pat@acme.test' };
const GITHUB: Person = { name: 'GitHub', email: 'noreply@github.com' };

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const pseudonym = (seed: string) => `dev-${sha256(seed).slice(0, 16)}`;

let root: string;
/** Hermetic environment: no system config, and a HOME with the developer's git user. */
let env: NodeJS.ProcessEnv;

function git(cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  return execFileSync('git', args, {
    cwd,
    env: { ...env, ...extra },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function as(author: Person, epoch: number, committer = author) {
  const date = `@${epoch} +0000`;
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
    GIT_COMMITTER_DATE: date,
  };
}

function commit(repo: string, file: string, identity: NodeJS.ProcessEnv) {
  writeFileSync(join(repo, file), file);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', file], identity);
}

function clone(remote: string, dir: string, ref?: string) {
  const url = pathToFileURL(remote).href;
  const depth = dir.startsWith('full') ? [] : ['--depth', '1'];
  git(root, ['clone', '-q', ...depth, url, join(root, dir)]);
  if (!ref) return;
  git(join(root, dir), ['fetch', '-q', ...depth, 'origin', ref]);
  git(join(root, dir), ['checkout', '-q', '--detach', 'FETCH_HEAD']);
}

/** Detect from inside `dir`, as Vitest does when the checkout is the cwd. */
function detectIn(dir: string) {
  const cwd = process.cwd();
  process.chdir(join(root, dir));
  try {
    // Read both people here: the first read of `committer` runs git.
    const { developer, committer } = detectIdentities(env);
    return { developer, committer };
  } finally {
    process.chdir(cwd);
  }
}

describe('detectIdentities on a real git checkout', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'identity-git-'));
    const home = join(root, 'home');
    mkdirSync(home);
    writeFileSync(
      join(home, '.gitconfig'),
      '[user]\n\tname = Jane Dev\n\temail = jane@acme.test\n',
    );
    env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };

    const remote = join(root, 'remote');
    mkdirSync(remote);
    git(remote, ['init', '-q']);
    git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    commit(remote, 'base.txt', as(MAINTAINER, 1_000_000_000));
    git(remote, ['checkout', '-q', '-b', 'feature']);
    commit(remote, 'feature.txt', as(AI_AGENT, 1_000_003_000));
    git(remote, ['checkout', '-q', 'main']);
    commit(remote, 'release.txt', as(RELEASE_BOT, 1_000_002_000, GITHUB));
    git(remote, ['checkout', '-q', '-b', 'pull-1-merge']);
    git(
      remote,
      ['merge', '-q', '--no-ff', '--no-edit', 'feature'],
      as(PR_OPENER, 1_000_004_000, GITHUB),
    );
    git(remote, ['update-ref', 'refs/pull/1/merge', 'HEAD']);
    git(remote, ['checkout', '-q', 'main']);

    clone(remote, 'shallow', 'refs/pull/1/merge');
    clone(remote, 'full', 'refs/pull/1/merge');
    clone(remote, 'main-tip');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses a fixture where the last non-merge author depends on the depth', () => {
    // The defect from the review: `--no-merges` returns the synthetic merge
    // commit in a shallow clone, and the AI agent commit in a full one.
    const lastAuthor = (dir: string) =>
      git(join(root, dir), ['log', '-1', '--no-merges', '--format=%ae']);
    expect(lastAuthor('shallow')).toBe(PR_OPENER.email);
    expect(lastAuthor('full')).toBe(AI_AGENT.email);
  });

  it('detects the same people in a shallow and in a full clone', () => {
    const people = {
      developer: {
        username: 'Jane Dev',
        email: 'jane@acme.test',
        pseudonymizedId: pseudonym('jane@acme.test'),
      },
      // GitHub committed the merge, so its author stands in for it.
      committer: {
        username: PR_OPENER.name,
        email: PR_OPENER.email,
        pseudonymizedId: pseudonym(PR_OPENER.email),
      },
    };
    expect(detectIn('shallow')).toEqual(people);
    expect(detectIn('full')).toEqual(people);
  });

  it('detects no committer when a bot authored HEAD', () => {
    expect(detectIn('main-tip').committer).toBeUndefined();
  });
});

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
// them. It is cloned shallow (the `actions/checkout` default) and in full.

type Author = { name: string; email: string };

const MAINTAINER: Author = {
  name: 'Maintainer',
  email: 'maintainer@acme.test',
};
const RELEASE_BOT: Author = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};
const AI_AGENT: Author = { name: 'Claude', email: 'noreply@anthropic.com' };
const PR_OPENER: Author = { name: 'Pat Opener', email: 'pat@acme.test' };

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const pseudonym = (v: string) => `dev-${sha256(v).slice(0, 16)}`;

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

function as(author: Author, epoch: number): NodeJS.ProcessEnv {
  const date = `@${epoch} +0000`;
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
    GIT_COMMITTER_DATE: date,
  };
}

function commit(repo: string, author: Author, epoch: number, file: string) {
  writeFileSync(join(repo, file), file);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', file], as(author, epoch));
}

function cloneMergeRef(remote: string, dir: string, shallow: boolean) {
  const depth = shallow ? ['--depth', '1'] : [];
  const url = pathToFileURL(remote).href;
  git(root, ['clone', '-q', '--no-checkout', ...depth, url, dir]);
  git(dir, ['fetch', '-q', ...depth, 'origin', 'refs/pull/1/merge']);
  git(dir, ['checkout', '-q', '--detach', 'FETCH_HEAD']);
}

/** Detect from inside `dir`, as Vitest does when the checkout is the cwd. */
function detectIn(dir: string) {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    return detectIdentities(env);
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
    commit(remote, MAINTAINER, 1_000_000_000, 'base.txt');
    git(remote, ['checkout', '-q', '-b', 'feature']);
    commit(remote, AI_AGENT, 1_000_003_000, 'feature.txt');
    git(remote, ['checkout', '-q', 'main']);
    commit(remote, RELEASE_BOT, 1_000_002_000, 'release.txt');
    git(remote, ['checkout', '-q', '-b', 'pull-1-merge']);
    git(
      remote,
      ['merge', '-q', '--no-ff', '--no-edit', 'feature'],
      as(PR_OPENER, 1_000_004_000),
    );
    git(remote, ['update-ref', 'refs/pull/1/merge', 'HEAD']);
    git(remote, ['checkout', '-q', 'main']);

    cloneMergeRef(remote, join(root, 'shallow'), true);
    cloneMergeRef(remote, join(root, 'full'), false);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses a fixture where the last commit author depends on the depth', () => {
    // The defect from the review: the last non-merge commit is the synthetic
    // merge commit in a shallow clone, and the AI agent commit in a full one.
    const lastAuthor = (dir: string) =>
      git(join(root, dir), ['log', '-1', '--no-merges', '--format=%ae']);
    expect(lastAuthor('shallow')).toBe(PR_OPENER.email);
    expect(lastAuthor('full')).toBe(AI_AGENT.email);
  });

  it('detects the git user, the same in a shallow and in a full clone', () => {
    const jane = {
      developer: {
        id: pseudonym('jane@acme.test'),
        username: 'Jane Dev',
        email: 'jane@acme.test',
      },
    };
    expect(detectIn(join(root, 'shallow'))).toEqual(jane);
    expect(detectIn(join(root, 'full'))).toEqual(jane);
  });
});

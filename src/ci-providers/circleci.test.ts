import { describe, expect, it } from 'vitest';
import { CircleCIProvider } from './circleci.js';

describe('CircleCIProvider', () => {
  const env = {
    CI: 'true',
    CIRCLECI: 'true',
    CIRCLE_WORKFLOW_ID: 'wf-1',
    CIRCLE_BUILD_URL: 'https://circleci.com/build/1',
    CIRCLE_BRANCH: 'main',
    CIRCLE_SHA1: 'abc123',
    CIRCLE_PROJECT_REPONAME: 'widgets',
    CIRCLE_WORKING_DIRECTORY: '~/project',
    CIRCLE_JOB: 'build-and-test',
    CIRCLE_PULL_REQUEST: 'https://github.com/acme/widgets/pull/3',
  };

  it('extracts run metadata from CIRCLE_* variables', () => {
    expect(CircleCIProvider.isActive(env)).toBe(true);
    expect(CircleCIProvider.repository(env)).toBe('widgets');
    expect(CircleCIProvider.branch(env)).toBe('main');
    expect(CircleCIProvider.commitSha(env)).toBe('abc123');
    expect(CircleCIProvider.runUrl(env)).toBe('https://circleci.com/build/1');
    expect(CircleCIProvider.workflowId(env)).toBe('wf-1');
  });

  it('exposes the working directory as the checkout root path', () => {
    expect(CircleCIProvider.rootPath(env)).toBe('~/project');
  });

  it('exposes the job name and pull request URL, but no commit URL', () => {
    expect(CircleCIProvider.jobName(env)).toBe('build-and-test');
    expect(CircleCIProvider.pullRequestUrl(env)).toBe(
      'https://github.com/acme/widgets/pull/3',
    );
    expect(CircleCIProvider.commitUrl(env)).toBeUndefined();
  });

  it('snapshots only its own environment keys', () => {
    expect(CircleCIProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});

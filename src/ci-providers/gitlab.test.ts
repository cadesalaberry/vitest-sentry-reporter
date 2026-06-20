import { describe, expect, it } from 'vitest';
import { GitLabCIProvider } from './gitlab.js';

describe('GitLabCIProvider', () => {
  const env = {
    CI: 'true',
    GITLAB_CI: 'true',
    CI_PROJECT_PATH: 'acme/widgets',
    CI_PROJECT_URL: 'https://gitlab.com/acme/widgets',
    CI_COMMIT_BRANCH: 'main',
    CI_COMMIT_SHA: 'abc123',
    CI_PROJECT_DIR: '/builds/acme/widgets',
    CI_JOB_NAME: 'unit',
    CI_JOB_URL: 'https://gitlab.com/acme/widgets/-/jobs/99',
    CI_PIPELINE_ID: 'pipe-1',
    CI_MERGE_REQUEST_IID: '7',
  };

  it('extracts run metadata from GitLab variables', () => {
    expect(GitLabCIProvider.isActive(env)).toBe(true);
    expect(GitLabCIProvider.repository(env)).toBe('acme/widgets');
    expect(GitLabCIProvider.branch(env)).toBe('main');
    expect(GitLabCIProvider.commitSha(env)).toBe('abc123');
    expect(GitLabCIProvider.runUrl(env)).toBe(
      'https://gitlab.com/acme/widgets/-/jobs/99',
    );
    expect(GitLabCIProvider.workflowId(env)).toBe('pipe-1');
  });

  it('exposes the project directory as the checkout root path', () => {
    expect(GitLabCIProvider.rootPath(env)).toBe('/builds/acme/widgets');
  });

  it('builds job name, merge request and commit URLs from project URL', () => {
    expect(GitLabCIProvider.jobName(env)).toBe('unit');
    expect(GitLabCIProvider.pullRequestUrl(env)).toBe(
      'https://gitlab.com/acme/widgets/-/merge_requests/7',
    );
    expect(GitLabCIProvider.commitUrl(env)).toBe(
      'https://gitlab.com/acme/widgets/-/commit/abc123',
    );
  });

  it('has no merge request URL outside a merge request pipeline', () => {
    const { CI_MERGE_REQUEST_IID: _omitted, ...partial } = env;
    expect(GitLabCIProvider.pullRequestUrl(partial)).toBeUndefined();
  });

  it('has no commit URL when the commit SHA is missing', () => {
    const { CI_COMMIT_SHA: _omitted, ...partial } = env;
    expect(GitLabCIProvider.commitUrl(partial)).toBeUndefined();
  });

  it('snapshots only its own environment keys', () => {
    expect(GitLabCIProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});

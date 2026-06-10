import { describe, expect, it } from 'vitest';
import {
  BuildkiteProvider,
  CircleCIProvider,
  detectProvider,
  GenericCIProvider,
  GitHubActionsProvider,
  GitLabCIProvider,
  JenkinsProvider,
} from './index.js';

describe('detectProvider', () => {
  it('returns undefined when no CI markers are present', () => {
    expect(detectProvider({})).toBeUndefined();
  });

  it('detects each provider from its marker variable', () => {
    expect(detectProvider({ GITHUB_ACTIONS: 'true' })?.name).toBe('github');
    expect(detectProvider({ CIRCLECI: 'true' })?.name).toBe('circleci');
    expect(detectProvider({ BUILDKITE: 'true' })?.name).toBe('buildkite');
    expect(detectProvider({ GITLAB_CI: 'true' })?.name).toBe('gitlab');
    expect(detectProvider({ JENKINS_URL: 'https://jenkins.local' })?.name).toBe(
      'jenkins',
    );
  });

  it('falls back to the generic provider when only CI is set', () => {
    expect(detectProvider({ CI: 'true' })?.name).toBe('ci');
  });

  it('prefers a specific provider over the generic CI flag', () => {
    expect(detectProvider({ CI: 'true', GITLAB_CI: 'true' })?.name).toBe(
      'gitlab',
    );
  });

  it('does not treat an empty marker value as active', () => {
    expect(detectProvider({ GITHUB_ACTIONS: '' })).toBeUndefined();
  });
});

describe('GitHubActionsProvider', () => {
  const env = {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'acme/widgets',
    GITHUB_RUN_ID: '123',
    GITHUB_REF_NAME: 'main',
    GITHUB_SHA: 'abc123',
  };

  it('extracts repository, branch and commit', () => {
    expect(GitHubActionsProvider.isActive(env)).toBe(true);
    expect(GitHubActionsProvider.repository(env)).toBe('acme/widgets');
    expect(GitHubActionsProvider.branch(env)).toBe('main');
    expect(GitHubActionsProvider.commitSha(env)).toBe('abc123');
    expect(GitHubActionsProvider.workflowId(env)).toBe('123');
  });

  it('composes the run URL from server, repository and run id', () => {
    expect(GitHubActionsProvider.runUrl(env)).toBe(
      'https://github.com/acme/widgets/actions/runs/123',
    );
  });

  it('returns no run URL when a component is missing', () => {
    const { GITHUB_RUN_ID: _omitted, ...partial } = env;
    expect(GitHubActionsProvider.runUrl(partial)).toBeUndefined();
  });

  it('snapshots only its own environment keys', () => {
    expect(GitHubActionsProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(
      env,
    );
  });
});

describe('CircleCIProvider', () => {
  const env = {
    CI: 'true',
    CIRCLECI: 'true',
    CIRCLE_WORKFLOW_ID: 'wf-1',
    CIRCLE_BUILD_URL: 'https://circleci.com/build/1',
    CIRCLE_BRANCH: 'main',
    CIRCLE_SHA1: 'abc123',
    CIRCLE_PROJECT_REPONAME: 'widgets',
  };

  it('extracts run metadata from CIRCLE_* variables', () => {
    expect(CircleCIProvider.isActive(env)).toBe(true);
    expect(CircleCIProvider.repository(env)).toBe('widgets');
    expect(CircleCIProvider.branch(env)).toBe('main');
    expect(CircleCIProvider.commitSha(env)).toBe('abc123');
    expect(CircleCIProvider.runUrl(env)).toBe('https://circleci.com/build/1');
    expect(CircleCIProvider.workflowId(env)).toBe('wf-1');
  });

  it('snapshots only its own environment keys', () => {
    expect(CircleCIProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});

describe('BuildkiteProvider', () => {
  const env = {
    CI: 'true',
    BUILDKITE: 'true',
    BUILDKITE_BUILD_URL: 'https://buildkite.com/build/1',
    BUILDKITE_BRANCH: 'main',
    BUILDKITE_COMMIT: 'abc123',
    BUILDKITE_PIPELINE_ID: 'pipe-1',
  };

  it('extracts run metadata from BUILDKITE_* variables', () => {
    expect(BuildkiteProvider.isActive(env)).toBe(true);
    expect(BuildkiteProvider.repository(env)).toBeUndefined();
    expect(BuildkiteProvider.branch(env)).toBe('main');
    expect(BuildkiteProvider.commitSha(env)).toBe('abc123');
    expect(BuildkiteProvider.runUrl(env)).toBe('https://buildkite.com/build/1');
    expect(BuildkiteProvider.workflowId(env)).toBe('pipe-1');
  });

  it('snapshots only its own environment keys', () => {
    expect(BuildkiteProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});

describe('GitLabCIProvider', () => {
  const env = {
    CI: 'true',
    GITLAB_CI: 'true',
    CI_PROJECT_PATH: 'acme/widgets',
    CI_COMMIT_BRANCH: 'main',
    CI_COMMIT_SHA: 'abc123',
  };

  it('extracts run metadata from GitLab variables', () => {
    expect(GitLabCIProvider.isActive(env)).toBe(true);
    expect(GitLabCIProvider.repository(env)).toBe('acme/widgets');
    expect(GitLabCIProvider.branch(env)).toBe('main');
    expect(GitLabCIProvider.commitSha(env)).toBe('abc123');
    expect(GitLabCIProvider.runUrl(env)).toBeUndefined();
    expect(GitLabCIProvider.workflowId(env)).toBeUndefined();
  });

  it('snapshots only its own environment keys', () => {
    expect(GitLabCIProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});

describe('JenkinsProvider', () => {
  const env = {
    CI: 'true',
    JENKINS_URL: 'https://jenkins.local',
    BUILD_URL: 'https://jenkins.local/job/1',
  };

  it('extracts the build URL and leaves git metadata undefined', () => {
    expect(JenkinsProvider.isActive(env)).toBe(true);
    expect(JenkinsProvider.repository(env)).toBeUndefined();
    expect(JenkinsProvider.branch(env)).toBeUndefined();
    expect(JenkinsProvider.commitSha(env)).toBeUndefined();
    expect(JenkinsProvider.runUrl(env)).toBe('https://jenkins.local/job/1');
    expect(JenkinsProvider.workflowId(env)).toBeUndefined();
  });

  it('snapshots only its own environment keys', () => {
    expect(JenkinsProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});

describe('GenericCIProvider', () => {
  const env = { CI: 'true' };

  it('reports no metadata beyond the CI flag', () => {
    expect(GenericCIProvider.isActive(env)).toBe(true);
    expect(GenericCIProvider.repository(env)).toBeUndefined();
    expect(GenericCIProvider.branch(env)).toBeUndefined();
    expect(GenericCIProvider.commitSha(env)).toBeUndefined();
    expect(GenericCIProvider.runUrl(env)).toBeUndefined();
    expect(GenericCIProvider.workflowId(env)).toBeUndefined();
  });

  it('snapshots only the CI flag', () => {
    expect(GenericCIProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});

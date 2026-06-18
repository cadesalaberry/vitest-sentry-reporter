import { describe, expect, it } from 'vitest';
import { JenkinsProvider } from './jenkins.js';

describe('JenkinsProvider', () => {
  const env = {
    CI: 'true',
    JENKINS_URL: 'https://jenkins.local',
    BUILD_URL: 'https://jenkins.local/job/1',
    WORKSPACE: '/var/jenkins_home/workspace/widgets',
    JOB_NAME: 'widgets/PR-12',
    CHANGE_URL: 'https://github.com/acme/widgets/pull/12',
  };

  it('extracts the build URL and leaves git metadata undefined', () => {
    expect(JenkinsProvider.isActive(env)).toBe(true);
    expect(JenkinsProvider.repository(env)).toBeUndefined();
    expect(JenkinsProvider.branch(env)).toBeUndefined();
    expect(JenkinsProvider.commitSha(env)).toBeUndefined();
    expect(JenkinsProvider.runUrl(env)).toBe('https://jenkins.local/job/1');
    expect(JenkinsProvider.workflowId(env)).toBeUndefined();
  });

  it('exposes the workspace as the checkout root path', () => {
    expect(JenkinsProvider.rootPath(env)).toBe(
      '/var/jenkins_home/workspace/widgets',
    );
  });

  it('exposes the job name and PR URL from the branch source plugin', () => {
    expect(JenkinsProvider.jobName(env)).toBe('widgets/PR-12');
    expect(JenkinsProvider.pullRequestUrl(env)).toBe(
      'https://github.com/acme/widgets/pull/12',
    );
    expect(JenkinsProvider.commitUrl(env)).toBeUndefined();
  });

  it('snapshots only its own environment keys', () => {
    expect(JenkinsProvider.envSnapshot({ ...env, SECRET: 'x' })).toEqual(env);
  });
});

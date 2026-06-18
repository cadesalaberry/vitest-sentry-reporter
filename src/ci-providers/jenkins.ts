import type { CIProvider } from './types.js';

export const JenkinsProvider: CIProvider = {
  name: 'jenkins',
  isActive: (env) => Boolean(env.JENKINS_URL),
  repository: (_env) => undefined,
  branch: (_env) => undefined,
  commitSha: (_env) => undefined,
  runUrl: (env) => env.BUILD_URL,
  workflowId: (_env) => undefined,
  // CHANGE_URL is set by the GitHub/GitLab branch source plugins for PR/MR builds.
  pullRequestUrl: (env) => env.CHANGE_URL,
  jobName: (env) => env.JOB_NAME,
  commitUrl: (_env) => undefined,
  rootPath: (env) => env.WORKSPACE,
  envSnapshot: (env) => {
    const keys = [
      'CI',
      'JENKINS_URL',
      'BUILD_URL',
      'WORKSPACE',
      'JOB_NAME',
      'CHANGE_URL',
    ];
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = env[k];
    return out;
  },
};

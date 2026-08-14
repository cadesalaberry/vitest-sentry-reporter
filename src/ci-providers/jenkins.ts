import type { CIProvider } from './types.js';

export const JenkinsProvider: CIProvider = {
  name: 'jenkins',
  isActive: (env) => Boolean(env.JENKINS_URL),
  // On PR/MR builds the branch-source plugins expose the change author; the
  // build-user-vars plugin exposes whoever started the build (BUILD_USER_*).
  triggeredBy: (env) => {
    const username = env.CHANGE_AUTHOR ?? env.BUILD_USER_ID;
    const name = env.CHANGE_AUTHOR_DISPLAY_NAME ?? env.BUILD_USER;
    const email = env.CHANGE_AUTHOR_EMAIL ?? env.BUILD_USER_EMAIL;
    return username || name || email
      ? { username: username ?? name, email }
      : undefined;
  },
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

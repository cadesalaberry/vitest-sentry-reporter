import type { CIProvider } from './types.js';

export const GitLabCIProvider: CIProvider = {
  name: 'gitlab',
  isActive: (env) => Boolean(env.GITLAB_CI),
  // GitLab exposes the triggering user's login, id, display name and email.
  triggeredBy: (env) => {
    const username = env.GITLAB_USER_LOGIN ?? env.GITLAB_USER_NAME;
    return username || env.GITLAB_USER_ID || env.GITLAB_USER_EMAIL
      ? { username, id: env.GITLAB_USER_ID, email: env.GITLAB_USER_EMAIL }
      : undefined;
  },
  repository: (env) => env.CI_PROJECT_PATH,
  branch: (env) => env.CI_COMMIT_BRANCH,
  commitSha: (env) => env.CI_COMMIT_SHA,
  runUrl: (env) => env.CI_JOB_URL,
  workflowId: (env) => env.CI_PIPELINE_ID,
  pullRequestUrl: (env) =>
    env.CI_PROJECT_URL && env.CI_MERGE_REQUEST_IID
      ? `${env.CI_PROJECT_URL}/-/merge_requests/${env.CI_MERGE_REQUEST_IID}`
      : undefined,
  jobName: (env) => env.CI_JOB_NAME,
  commitUrl: (env) =>
    env.CI_PROJECT_URL && env.CI_COMMIT_SHA
      ? `${env.CI_PROJECT_URL}/-/commit/${env.CI_COMMIT_SHA}`
      : undefined,
  rootPath: (env) => env.CI_PROJECT_DIR,
  envSnapshot: (env) => {
    const keys = [
      'CI',
      'GITLAB_CI',
      'CI_PROJECT_PATH',
      'CI_PROJECT_URL',
      'CI_COMMIT_BRANCH',
      'CI_COMMIT_SHA',
      'CI_PROJECT_DIR',
      'CI_JOB_NAME',
      'CI_JOB_URL',
      'CI_PIPELINE_ID',
      'CI_MERGE_REQUEST_IID',
    ];
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = env[k];
    return out;
  },
};

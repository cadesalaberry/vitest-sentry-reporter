import type { CIProvider } from './types.js';

export const BuildkiteProvider: CIProvider = {
  name: 'buildkite',
  isActive: (env) => Boolean(env.BUILDKITE),
  repository: (_env) => undefined,
  branch: (env) => env.BUILDKITE_BRANCH,
  commitSha: (env) => env.BUILDKITE_COMMIT,
  runUrl: (env) => env.BUILDKITE_BUILD_URL,
  workflowId: (env) => env.BUILDKITE_PIPELINE_ID,
  // BUILDKITE_PULL_REQUEST is the PR number (or "false"), not a URL, and there
  // is no portable env var for the host's PR/commit web URL, so leave them
  // undefined rather than guess.
  pullRequestUrl: (_env) => undefined,
  jobName: (env) => env.BUILDKITE_LABEL,
  commitUrl: (_env) => undefined,
  rootPath: (env) => env.BUILDKITE_BUILD_CHECKOUT_PATH,
  envSnapshot: (env) => {
    const keys = [
      'CI',
      'BUILDKITE',
      'BUILDKITE_BUILD_URL',
      'BUILDKITE_BRANCH',
      'BUILDKITE_COMMIT',
      'BUILDKITE_PIPELINE_ID',
      'BUILDKITE_BUILD_CHECKOUT_PATH',
      'BUILDKITE_LABEL',
      'BUILDKITE_PULL_REQUEST',
    ];
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = env[k];
    return out;
  },
};

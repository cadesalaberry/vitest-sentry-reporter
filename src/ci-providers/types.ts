export interface CIProvider {
  readonly name: string;
  isActive(env: NodeJS.ProcessEnv): boolean;
  repository(env: NodeJS.ProcessEnv): string | undefined;
  branch(env: NodeJS.ProcessEnv): string | undefined;
  commitSha(env: NodeJS.ProcessEnv): string | undefined;
  runUrl(env: NodeJS.ProcessEnv): string | undefined;
  workflowId(env: NodeJS.ProcessEnv): string | undefined;
  /**
   * URL of the pull/merge request the run belongs to, when the run was
   * triggered by one. Useful as a direct triage link from a failure.
   */
  pullRequestUrl(env: NodeJS.ProcessEnv): string | undefined;
  /**
   * Human-readable name of the current job, step or shard within the run
   * (e.g. the GitHub job id, GitLab/CircleCI job name, Buildkite step label).
   */
  jobName(env: NodeJS.ProcessEnv): string | undefined;
  /**
   * Direct URL to the commit under test on the hosting provider's web UI, when
   * it can be derived from the CI environment.
   */
  commitUrl(env: NodeJS.ProcessEnv): string | undefined;
  /**
   * Absolute path to the checked-out repository root, as exposed by the CI
   * system. Used to locate a `CODEOWNERS` file and relativize test file paths.
   */
  rootPath(env: NodeJS.ProcessEnv): string | undefined;
  /**
   * Minimal, provider-specific environment snapshot useful for debugging links and context.
   */
  envSnapshot(env: NodeJS.ProcessEnv): Record<string, string | undefined>;
}

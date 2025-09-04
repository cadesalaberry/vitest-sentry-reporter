export interface CIProvider {
  readonly name: string;
  isActive(env: NodeJS.ProcessEnv): boolean;
  repository(env: NodeJS.ProcessEnv): string | undefined;
  branch(env: NodeJS.ProcessEnv): string | undefined;
  commitSha(env: NodeJS.ProcessEnv): string | undefined;
  runUrl(env: NodeJS.ProcessEnv): string | undefined;
  workflowId(env: NodeJS.ProcessEnv): string | undefined;
  /**
   * Minimal, provider-specific environment snapshot useful for debugging links and context.
   */
  envSnapshot(env: NodeJS.ProcessEnv): Record<string, string | undefined>;
}



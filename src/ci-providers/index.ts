import type { CIProvider } from './types';
import { GitHubActionsProvider } from './github';
import { CircleCIProvider } from './circleci';
import { BuildkiteProvider } from './buildkite';
import { GitLabCIProvider } from './gitlab';
import { JenkinsProvider } from './jenkins';
import { GenericCIProvider } from './generic';

const PROVIDERS: CIProvider[] = [
  GitHubActionsProvider,
  CircleCIProvider,
  BuildkiteProvider,
  GitLabCIProvider,
  JenkinsProvider,
  GenericCIProvider,
];

export function detectProvider(env: NodeJS.ProcessEnv): CIProvider | undefined {
  for (const p of PROVIDERS) {
    if (p.isActive(env)) return p;
  }
  return undefined;
}

export { type CIProvider } from './types';
export {
  GitHubActionsProvider,
  CircleCIProvider,
  BuildkiteProvider,
  GitLabCIProvider,
  JenkinsProvider,
  GenericCIProvider,
};



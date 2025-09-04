import type { CIProvider } from './types.js';
import { GitHubActionsProvider } from './github.js';
import { CircleCIProvider } from './circleci.js';
import { BuildkiteProvider } from './buildkite.js';
import { GitLabCIProvider } from './gitlab.js';
import { JenkinsProvider } from './jenkins.js';
import { GenericCIProvider } from './generic.js';

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

export { type CIProvider } from './types.js';
export {
  GitHubActionsProvider,
  CircleCIProvider,
  BuildkiteProvider,
  GitLabCIProvider,
  JenkinsProvider,
  GenericCIProvider,
};



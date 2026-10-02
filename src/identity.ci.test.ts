import { describe, expect, it } from 'vitest';
import { detectIdentities } from './identity.js';

// No mocks: the real actor registry and the real GitHub provider. The tests
// read only `developer`, which in CI comes from the environment, so no git
// command runs.

const GITHUB_ACTIONS = { GITHUB_ACTIONS: 'true' };

describe('detectIdentities on GitHub Actions', () => {
  it('counts the developer who re-runs the job of a bot', () => {
    // A developer re-runs the failing checks of a Dependabot pull request.
    const { developer } = detectIdentities({
      ...GITHUB_ACTIONS,
      GITHUB_ACTOR: 'dependabot[bot]',
      GITHUB_ACTOR_ID: '49699333',
      GITHUB_TRIGGERING_ACTOR: 'alice',
    });

    expect(developer).toMatchObject({ username: 'alice' });
    // GITHUB_ACTOR_ID is the id of Dependabot, not of Alice.
    expect(developer).not.toHaveProperty('id');
  });

  it('counts no developer when a bot runs or re-runs the job', () => {
    const bots = [
      {
        GITHUB_ACTOR: 'dependabot[bot]',
        GITHUB_TRIGGERING_ACTOR: 'dependabot[bot]',
      },
      { GITHUB_ACTOR: 'alice', GITHUB_TRIGGERING_ACTOR: 'retry-app[bot]' },
    ];

    for (const env of bots) {
      const { developer } = detectIdentities({ ...GITHUB_ACTIONS, ...env });
      expect(developer).toBeUndefined();
    }
  });
});

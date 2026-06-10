import { describe, expect, it } from 'vitest';
import VitestSentryReporter, {
  ACTOR_DETECTORS,
  ACTOR_NAME_ENV,
  ACTOR_TYPE_ENV,
  detectActor,
  detectTrigger,
  TRIGGER_ENV,
} from './index.js';

describe('package entry point', () => {
  it('default-exports the reporter class', () => {
    const reporter = new VitestSentryReporter();
    expect(reporter.name).toBe('vitest-sentry-reporter');
  });

  it('re-exports the actor and trigger detection helpers', () => {
    expect(ACTOR_DETECTORS.length).toBeGreaterThan(0);
    expect(ACTOR_TYPE_ENV).toBe('VITEST_SENTRY_ACTOR_TYPE');
    expect(ACTOR_NAME_ENV).toBe('VITEST_SENTRY_ACTOR_NAME');
    expect(TRIGGER_ENV).toBe('VITEST_SENTRY_TRIGGER');
    expect(typeof detectActor).toBe('function');
    expect(typeof detectTrigger).toBe('function');
  });
});

export class VitestSentryReporter {
  public name: string;

  constructor() {
    this.name = 'vitest-sentry-reporter';
  }

  onInit(): void {
    // no-op placeholder
  }

  onFinished(): void {
    // no-op placeholder
  }
}

export default VitestSentryReporter;


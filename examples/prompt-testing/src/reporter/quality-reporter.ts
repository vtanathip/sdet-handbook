import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import type { StepResult, TestSuiteReport } from './report-types.js';

const RESULTS_DIR = 'results';

export default class QualityReporter implements Reporter {
  private readonly suites = new Map<string, TestSuiteReport>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const suiteName = test.titlePath().slice(0, -1).join(' > ') || 'Default Suite';
    const existing = this.suites.get(suiteName) ?? {
      suiteName,
      startTime: result.startTime.getTime(),
      totalDurationMs: 0,
      steps: [] as StepResult[],
      overallStatus: 'passed' as const,
    };

    const steps: StepResult[] = result.attachments
      .filter((a) => a.name === 'nl-step-result' && a.body)
      .map((a) => JSON.parse(a.body!.toString()) as StepResult);

    existing.steps.push(...steps);
    existing.totalDurationMs += result.duration;
    if (result.status !== 'passed') existing.overallStatus = 'failed';

    this.suites.set(suiteName, existing);
  }

  async onEnd(): Promise<void> {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });

    const allSuites = Array.from(this.suites.values());

    // quality-report.json — per-step AI confidence audit
    const qualityReport = {
      generatedAt: new Date().toISOString(),
      suites: allSuites.map((suite) => ({
        name: suite.suiteName,
        overallStatus: suite.overallStatus,
        steps: suite.steps.map((s) => ({
          index: s.stepIndex,
          text: s.stepText,
          status: s.status,
          confidence: s.aiConfidence,
          reasoning: s.aiReasoning,
          resolvedLocator: s.resolvedAction?.locator,
          locatorStrategy: s.resolvedAction?.locatorStrategy,
          cacheHit: s.cacheHit,
          errorMessage: s.errorMessage,
        })),
      })),
    };
    fs.writeFileSync(
      path.join(RESULTS_DIR, 'quality-report.json'),
      JSON.stringify(qualityReport, null, 2),
    );

    // time-report.json — timing breakdown per step and suite
    const timeReport = {
      generatedAt: new Date().toISOString(),
      suites: allSuites.map((suite) => {
        const slowest = suite.steps.length
          ? suite.steps.reduce((a, b) => (a.durationMs > b.durationMs ? a : b))
          : null;
        const aiMs = suite.steps.filter((s) => !s.cacheHit).reduce((acc, s) => acc + s.durationMs, 0);
        const cacheMs = suite.steps.filter((s) => s.cacheHit).reduce((acc, s) => acc + s.durationMs, 0);
        return {
          name: suite.suiteName,
          totalMs: suite.totalDurationMs,
          aiResolvedMs: aiMs,
          cacheHitMs: cacheMs,
          cacheHitRate: suite.steps.length
            ? `${Math.round((suite.steps.filter((s) => s.cacheHit).length / suite.steps.length) * 100)}%`
            : 'n/a',
          slowestStep: slowest
            ? { index: slowest.stepIndex, text: slowest.stepText, durationMs: slowest.durationMs }
            : null,
          steps: suite.steps.map((s) => ({
            index: s.stepIndex,
            text: s.stepText,
            durationMs: s.durationMs,
            status: s.status,
            cacheHit: s.cacheHit,
          })),
        };
      }),
    };
    fs.writeFileSync(
      path.join(RESULTS_DIR, 'time-report.json'),
      JSON.stringify(timeReport, null, 2),
    );
  }
}

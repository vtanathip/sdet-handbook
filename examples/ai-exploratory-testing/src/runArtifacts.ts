import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonlWriter } from './util/jsonl.js';

export interface RunPaths {
  runDir: string;
  findingsPath: string;
  eventsPath: string;
  metricsPath: string;
  screenshotsDir: string;
  browserEndpointPath: string;
}

export class RunArtifacts {
  readonly paths: RunPaths;
  readonly events: JsonlWriter;
  readonly metrics: JsonlWriter;

  private constructor(paths: RunPaths) {
    this.paths = paths;
    this.events = new JsonlWriter(paths.eventsPath);
    this.metrics = new JsonlWriter(paths.metricsPath);
  }

  static create(runsRoot: string): RunArtifacts {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = join(runsRoot, runId);
    const screenshotsDir = join(runDir, 'screenshots');
    mkdirSync(screenshotsDir, { recursive: true });

    const findingsPath = join(runDir, 'findings.jsonl');
    writeFileSync(findingsPath, '');

    return new RunArtifacts({
      runDir,
      findingsPath,
      eventsPath: join(runDir, 'events.jsonl'),
      metricsPath: join(runDir, 'metrics.jsonl'),
      screenshotsDir,
      browserEndpointPath: join(runDir, 'browser-endpoint.txt'),
    });
  }

  writeBrowserEndpoint(wsUrl: string): void {
    writeFileSync(this.paths.browserEndpointPath, wsUrl);
  }

  async close(): Promise<void> {
    await this.events.close();
    await this.metrics.close();
  }
}

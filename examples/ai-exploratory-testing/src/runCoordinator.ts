import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config } from './config.js';
import { RunArtifacts } from './runArtifacts.js';
import { SessionRunner } from './sessionRunner.js';
import { attachEventRecorder } from './eventRecorder.js';
import { MonitoringBundle } from './monitoringBundle.js';
import { buildSystemPrompt, buildFirstPrompt, STEP_PROMPT, CLOSE_PROMPT } from './promptLibrary.js';
import { selfTestDaemon, discoverCdpWs } from './daemonDiscovery.js';
import { buildReport } from './reportBuilder.js';
import { resolveAuthMode } from './authMode.js';
import { log } from './util/logger.js';

export interface CoordinatorOpts {
  config: Config;
  runsRoot: string;
  skillDir: string;
  daemonRoot: string;
}

export async function runOrchestration(opts: CoordinatorOpts): Promise<void> {
  const artifacts = RunArtifacts.create(opts.runsRoot);
  log('info', `run dir: ${artifacts.paths.runDir}`);

  selfTestDaemon(opts.daemonRoot);

  const systemPrompt = buildSystemPrompt(opts.config, artifacts.paths.findingsPath);
  const runner = await SessionRunner.create({
    systemPrompt,
    skillDirectories: [opts.skillDir],
  });
  const unsubEvents = attachEventRecorder(runner, artifacts.events);

  let monitoring: MonitoringBundle | undefined;
  let stopping = false;
  const sigintHandler = () => { log('info', 'SIGINT — stopping'); stopping = true; };
  process.on('SIGINT', sigintHandler);

  try {
    // --- setup: auth + browser open (generous timeout; login can take minutes) ---
    const authMode = resolveAuthMode(opts.config.authStateFile);
    log('info', `auth mode: ${authMode}`);
    await runner.sendAndWait(buildFirstPrompt(opts.config, authMode), 600_000);

    if (authMode === 'login-then-save' && opts.config.authStateFile) {
      await runner.sendAndWait(
        `Save the current browser storage state to "${opts.config.authStateFile}" ` +
        `using \`playwright-cli state-save ${opts.config.authStateFile}\`. ` +
        `Then signal task_complete.`,
        120_000,
      );
    }

    // --- discover CDP + start monitoring ---
    const cdpWs = await discoverCdpWs(opts.daemonRoot);
    artifacts.writeBrowserEndpoint(cdpWs);

    monitoring = new MonitoringBundle({
      cdpWsUrl: cdpWs,
      metrics: artifacts.metrics,
      intervalSec: opts.config.samplerIntervalSec,
      stuckDetectorSec: opts.config.stuckDetectorSec,
      runner,
    });
    await monitoring.start();

    // --- main loop ---
    const deadline = Date.now() + opts.config.runDurationHours * 3_600_000;
    while (!stopping && Date.now() < deadline) {
      try {
        await runner.sendAndWait(STEP_PROMPT);
      } catch (err) {
        log('error', 'sendAndWait threw', err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  } catch (err) {
    log('error', 'run failed', err);
  } finally {
    process.off('SIGINT', sigintHandler);
    if (monitoring) await monitoring.stop();
    try { await runner.sendAndWait(CLOSE_PROMPT, 60_000); }
    catch (err) { log('warn', 'final close prompt failed', err); }
    await runner.stop();
    unsubEvents();
    await artifacts.close();
    const report = await buildReport({
      eventsPath: artifacts.paths.eventsPath,
      metricsPath: artifacts.paths.metricsPath,
      findingsPath: artifacts.paths.findingsPath,
      screenshotsDir: artifacts.paths.screenshotsDir,
    });
    writeFileSync(join(artifacts.paths.runDir, 'report.md'), report);
    log('info', 'report written');
  }
}

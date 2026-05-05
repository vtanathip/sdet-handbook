import { loadConfig } from './config.js';
import { runOrchestration } from './runCoordinator.js';
import { join } from 'node:path';

function argFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const configPath = argFlag('config') ?? 'config.example.yaml';
const config = loadConfig(configPath);

const daemonRoot = join(
  process.env.LOCALAPPDATA ?? process.env.HOME ?? '.',
  'ms-playwright',
  'daemon',
);

await runOrchestration({
  config,
  runsRoot: 'runs',
  skillDir: 'runtime-skills/playwright-cli',
  daemonRoot,
});

// Force-exit: even after client.stop() some native handles
// (CDP WebSocket, child stdio) can keep the loop alive briefly.
// Everything user-facing was already flushed inside runOrchestration.
process.exit(0);

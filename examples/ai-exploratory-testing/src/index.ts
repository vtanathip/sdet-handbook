import { loadConfig } from './config.js';
import { runOrchestration } from './runCoordinator.js';
import { join } from 'node:path';

function argFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const configPath = argFlag('config') ?? 'config.local.yaml';
const config = loadConfig(configPath);

function resolveDaemonRoot(): string {
  const home = process.env.HOME ?? '.';
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ms-playwright', 'daemon');
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'ms-playwright', 'daemon');
  }
  // Linux
  return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'ms-playwright', 'daemon');
}

const daemonRoot = resolveDaemonRoot();

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

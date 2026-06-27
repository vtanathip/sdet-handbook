import { startRun } from '../src/runContext.js';

// Creates the shared run directory before any spec launches Electron.
export default function globalSetup(): void {
  const dir = startRun();
  console.log(`[electron-monitoring] run dir: ${dir}`);
}

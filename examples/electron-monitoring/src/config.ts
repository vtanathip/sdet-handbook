import { z } from 'zod';

// All thresholds in ms. Defaults target the bundled demo-app; every field is env-overridable
// so the same harness points at a real app later (source mode) or a packaged binary (cdp mode).
const ConfigSchema = z.object({
  launchMode: z.enum(['source', 'cdp']).default('source'),
  appPath: z.string().default('./demo-app'),
  cdpEndpoint: z.string().optional(),
  // Node-inspector endpoint of the app's MAIN process (launch the app with --inspect=<port>).
  // When set in cdp mode, it unlocks the main-process layers (L3/L4/L5) over the inspector.
  inspectEndpoint: z.string().optional(),
  heartbeatMs: z.number().default(200),
  mainLoopMeanMs: z.number().default(100),
  mainLoopMaxMs: z.number().default(200),
  metricsIntervalMs: z.number().default(250),
  cpuPctThreshold: z.number().default(90),
  memGrowthRatio: z.number().default(2.0),
  // IPC messages (renderer→main `send`) per metrics interval above which we flag an IPC storm.
  ipcStormMsgs: z.number().default(1000),
  deepEvidenceMinMs: z.number().default(3000),
  // recordVideo can jam Electron's CDP pipe in headless/displayless environments — opt-in.
  recordVideo: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

function num(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} is not a number: ${v}`);
  return n;
}

export function loadConfig(): Config {
  return ConfigSchema.parse({
    launchMode: process.env.LAUNCH_MODE,
    appPath: process.env.ELECTRON_APP_PATH,
    cdpEndpoint: process.env.ELECTRON_CDP_ENDPOINT,
    inspectEndpoint: process.env.ELECTRON_INSPECT_ENDPOINT,
    heartbeatMs: num('FREEZE_THRESHOLD_MS'),
    mainLoopMaxMs: num('MAIN_LOOP_MAX_MS'),
    metricsIntervalMs: num('METRICS_INTERVAL_MS'),
    deepEvidenceMinMs: num('DEEP_EVIDENCE_MIN_MS'),
    ipcStormMsgs: num('IPC_STORM_MSGS'),
    recordVideo: process.env.RECORD_VIDEO === '1' ? true : undefined,
  });
}

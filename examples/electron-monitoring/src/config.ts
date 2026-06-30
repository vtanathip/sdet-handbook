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
  // A network request in-flight longer than this is flagged as a stall (spinner that won't resolve).
  stallMs: z.number().default(5000),
  // Storage/disk thresholds.
  storagePct: z.number().default(0.8),          // fraction of quota that flags storage-pressure
  diskLowBytes: z.number().default(500 * 1024 * 1024), // free bytes under which disk-low fires
  ioSlowMs: z.number().default(750),            // tiny userData write slower than this = slow-disk
  // A spawned child still alive past this (while the app may be awaiting it) is flagged as hung.
  subprocessHungMs: z.number().default(10000),
  deepEvidenceMinMs: z.number().default(3000),
  // recordVideo can jam Electron's CDP pipe in headless/displayless environments — opt-in.
  recordVideo: z.boolean().default(false),
  // ── Full-capture (monitoring) mode ──────────────────────────────────────────────────────────────
  // This harness is a build-vs-build tracer, not just a freeze gate: each layer streams ALL of its
  // signal (every IPC message, every gap, every request) to its own jsonl, not only threshold breaches.
  // The threshold-based freeze emit still happens on top — these only control the continuous streams.
  captureAll: z.boolean().default(true),
  // Truncation/size ceilings for the streams. previewChars bounds a captured IPC/console payload
  // preview; streamMaxEvents caps any single stream file (we log + count drops past it, never silent).
  previewChars: z.number().default(200),
  streamMaxEvents: z.number().default(100_000),
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
    stallMs: num('STALL_MS'),
    storagePct: num('STORAGE_PCT'),
    diskLowBytes: num('DISK_LOW_BYTES'),
    ioSlowMs: num('IO_SLOW_MS'),
    subprocessHungMs: num('SUBPROCESS_HUNG_MS'),
    recordVideo: process.env.RECORD_VIDEO === '1' ? true : undefined,
    captureAll: process.env.CAPTURE_ALL === '0' ? false : undefined,
    previewChars: num('PREVIEW_CHARS'),
    streamMaxEvents: num('STREAM_MAX_EVENTS'),
  });
}

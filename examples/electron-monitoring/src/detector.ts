import type { ElectronApplication, Page } from 'playwright';
import type { Config } from './config.js';
import type { FreezeBus } from './freezeBus.js';

export interface DetectorCtx {
  page: Page;
  /** undefined in cdp mode — main-process layers (L3/L4/L5) are then unavailable */
  electronApp?: ElectronApplication;
  bus: FreezeBus;
  config: Config;
  runDir: string;
}

export interface Detector {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

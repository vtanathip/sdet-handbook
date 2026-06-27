import type { Page } from 'playwright';
import type { Config } from './config.js';
import type { FreezeBus } from './freezeBus.js';
import type { MainBridge } from './mainBridge.js';

export interface DetectorCtx {
  page: Page;
  /** Reaches the Electron main process (Playwright in source mode, Node inspector in cdp+inspect
   *  mode). Undefined for plain cdp with no --inspect — main-process layers L3/L4/L5 are then off. */
  mainBridge?: MainBridge;
  bus: FreezeBus;
  config: Config;
  runDir: string;
}

export interface Detector {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

import { EventEmitter } from 'node:events';

export type FreezeLayer =
  | 'renderer-heartbeat'
  | 'renderer-task'
  | 'main-loop'
  | 'hardware'
  | 'native'
  | 'ipc'
  | 'js-error'    // uncaught exception / unhandledrejection / console error (renderer or main)
  | 'stall'       // async-but-idle: hung request / unresolved invoke (loop alive, CPU low)
  | 'storage'     // storage usage/quota or disk pressure
  | 'subprocess'  // child_process spawn/exit/hang lifecycle
  | 'deep';

export type Severity = 'MINOR' | 'MODERATE' | 'SEVERE';

export interface FreezeEvent {
  layer: FreezeLayer;
  startIso: string;
  durationMs: number;
  severity: Severity;
  /** layer-specific payload: LoAF scripts, CPU%, fn name, event-loop max, … */
  detail: Record<string, unknown>;
  /** filled by the correlator at report time */
  action?: string;
}

// Same buckets as process-watchdog SessionLogger.cs: <1s MINOR / 1-3s MODERATE / >=3s SEVERE.
export function severityFor(durationMs: number): Severity {
  if (durationMs >= 3000) return 'SEVERE';
  if (durationMs >= 1000) return 'MODERATE';
  return 'MINOR';
}

/** Tiny typed pub/sub all detectors push to; the monitor + deepEvidence subscribe. */
export class FreezeBus {
  private readonly emitter = new EventEmitter();
  emit(ev: FreezeEvent): void {
    this.emitter.emit('freeze', ev);
  }
  onFreeze(fn: (ev: FreezeEvent) => void): void {
    this.emitter.on('freeze', fn);
  }
}

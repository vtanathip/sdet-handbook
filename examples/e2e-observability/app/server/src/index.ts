// ── Datadog APM + Continuous Profiler ──────────────────────────────────────
// MUST be the very first import so dd-trace can patch all subsequent modules.
import tracer from 'dd-trace';
tracer.init({
  service: process.env.DD_SERVICE ?? 'todo-api',
  env: process.env.DD_ENV ?? 'perf-test',
  version: process.env.DD_VERSION ?? '1.0.0',
  // Continuous Profiler — CPU, heap, and wall-clock profiles sent to Datadog
  profiling: process.env.DD_PROFILING_ENABLED !== 'false',
  // Inject trace/span IDs into log lines for log-trace correlation
  logInjection: true,
  runtimeMetrics: true,
});

// Load the app only after tracer.init() has executed.
// Use sync require here to guarantee express/pg are loaded after init.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./app');

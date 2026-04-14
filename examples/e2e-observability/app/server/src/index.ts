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

import path from 'path';
import express from 'express';
import cors from 'cors';
import todosRouter from './routes/todos';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Attach E2E request metadata to active request spans for Datadog filtering.
app.use((req, _res, next) => {
  const activeSpan = tracer.scope().active();
  if (!activeSpan) {
    return next();
  }

  const runId = req.header('x-e2e-run-id');
  const source = req.header('x-e2e-source');
  const testName = req.header('x-e2e-test-name');
  const requestId = req.header('x-e2e-request-id');

  if (runId) {
    activeSpan.setTag('e2e.run_id', runId);
  }
  if (source) {
    activeSpan.setTag('e2e.source', source);
  }
  if (testName) {
    activeSpan.setTag('e2e.test_name', testName);
  }
  if (requestId) {
    activeSpan.setTag('e2e.request_id', requestId);
  }

  next();
});

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/todos', todosRouter);

// Health check for load-balancers / GitLab CI readiness probes
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Serve React build in production ────────────────────────────────────────
// tsc compiles src/ → dist/, so __dirname is server/dist/ at runtime.
// client/dist is at server/dist/../../client/dist.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[todo-api] listening on port ${PORT} (env: ${process.env.DD_ENV})`);
});

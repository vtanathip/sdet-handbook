// ── Datadog APM + Continuous Profiler ──────────────────────────────────────
// MUST be the very first require so dd-trace can patch all subsequent modules.
require('dd-trace').init({
  service: process.env.DD_SERVICE || 'todo-api',
  env: process.env.DD_ENV || 'perf-test',
  version: process.env.DD_VERSION || '1.0.0',
  // Continuous Profiler — CPU, heap, and wall-clock profiles sent to Datadog
  profiling: process.env.DD_PROFILING_ENABLED !== 'false',
  // Inject trace/span IDs into log lines for log-trace correlation
  logInjection: true,
  // APM tracing is on by default; the following enables richer instrumentation
  runtimeMetrics: true,
});

const path = require('path');
const express = require('express');
const cors = require('cors');
const todosRouter = require('./routes/todos');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/todos', todosRouter);

// Health check for load-balancers / GitLab CI readiness probes
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Serve React build in production ────────────────────────────────────────
// The Pulumi userdata script runs `npm run build -w client` which outputs to
// client/dist. Express serves it as static and falls back to index.html for
// client-side routing.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[todo-api] listening on port ${PORT} (env: ${process.env.DD_ENV})`);
});

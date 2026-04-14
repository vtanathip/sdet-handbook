# E2E Observability Dashboard Metrics Guide

This document explains:
- what metrics are used in this dashboard
- where those metrics come from
- how to discover correct metrics for your own services
- what went wrong in the recent no-data issue and how to avoid it

## Dashboard Scope

The dashboard combines 4 telemetry sources:

1. APM trace metrics from Node.js dd-trace
2. Continuous Profiler metrics from dd-trace
3. Node.js runtime metrics from dd-trace runtime metrics
4. Host metrics from Datadog Agent (Windows PDH + system metrics)

## Where Sources Are Configured

- App tracing and runtime metrics are initialized in `app/server/src/index.ts` via `tracer.init(...)`.
- Datadog environment tags (`DD_SERVICE`, `DD_ENV`, `DD_VERSION`) are set in `infra/userdata.py`.
- Windows PDH counters are configured in `infra/userdata.py` in the `windows_performance_counters` conf.yaml block.

## How To Know Which Metric Names To Use

Do not guess metric names. Follow this order:

1. Identify producer type
   - APM trace metric: starts with `trace.`
   - Profiler metric: starts with `datadog.profiling.`
   - Node runtime metric: starts with `runtime.node.`
   - Host/agent metric: starts with `system.` or integration-specific names

2. For APM, determine actual span names from tracer integrations
   - In this project, Express requests produce `express.request` spans.
   - PostgreSQL queries (`pg`) produce `pg.query` spans.
   - Trace metrics are therefore `trace.express.request...` and `trace.pg.query...`.

3. Validate in Datadog before adding to dashboard
   - Use Metrics Explorer autocomplete for the metric name.
   - Use APM UI to verify spans exist for the service and env tags.
   - Generate traffic while validating so metrics are non-zero.

4. Build query with correct tag filters
   - Use template variables with prefixed variables correctly: `{$service,$env}`.
   - Do not double-prefix like `{service:$service,env:$env}` when variable already has `prefix`.

## Recent Incident (Why Widgets Showed No Data)

Root cause:
- Template variables were defined with prefixes (`service`, `env`), but queries also hardcoded prefixes.
- Example bad query filter: `{service:$service,env:$env}`
- At runtime this became `service:service:todo-api` and `env:env:perf-test`, so no series matched.

Fix:
- Use `{$service,$env}` and `{$env}` in queries.

Other fixes made during troubleshooting:
- Use `trace.express.request` (not `trace.http.request`).
- Use `trace.pg.query` (not `trace.postgresql.query`).
- Use `p95:trace.express.request{...}` (not `trace.express.request.duration`).
- Removed `trace.dns.lookup` and `trace.tcp.connect` widgets because those metrics are not emitted by dd-trace-js for this service.

## Metric Inventory In This Dashboard

### APM Request Flow and Endpoint Analysis

| Query Pattern | Meaning | Source |
|---|---|---|
| `sum:trace.express.request.hits{$service,$env}.as_count()` | request throughput | dd-trace Express integration |
| `sum:trace.express.request.errors{$service,$env}.as_count()` | error throughput | dd-trace Express integration |
| `avg:trace.express.request.apdex{$service,$env}` | apdex score | Datadog trace metric derived from Express spans |
| `p50:trace.express.request{$service,$env}` | p50 request latency | dd-trace Express integration |
| `p75:trace.express.request{$service,$env}` | p75 request latency | dd-trace Express integration |
| `p95:trace.express.request{$service,$env}` | p95 request latency | dd-trace Express integration |
| `p99:trace.express.request{$service,$env}` | p99 request latency | dd-trace Express integration |
| `sum:trace.express.request.hits{$service,$env} by {resource_name}.as_count()` | endpoint traffic ranking | dd-trace Express integration |
| `p95:trace.express.request{$service,$env} by {resource_name}` | endpoint p95 latency ranking | dd-trace Express integration |
| `sum:trace.express.request.errors{$service,$env} by {resource_name}.as_count()` | endpoint error ranking | dd-trace Express integration |
| `avg:trace.express.request{$service,$env} by {resource_name}` | endpoint latency over time | dd-trace Express integration |

### Database Latency (PostgreSQL)

| Query Pattern | Meaning | Source |
|---|---|---|
| `p50:trace.pg.query{$service,$env}` | p50 DB query latency | dd-trace pg integration |
| `p95:trace.pg.query{$service,$env}` | p95 DB query latency | dd-trace pg integration |
| `p99:trace.pg.query{$service,$env}` | p99 DB query latency | dd-trace pg integration |
| `avg:trace.pg.query{$service,$env}` | average DB query latency | dd-trace pg integration |

### Continuous Profiler Metrics

| Query Pattern | Meaning | Source |
|---|---|---|
| `avg:datadog.profiling.node.wall_time.ns{$service,$env}` | wall-clock time sampled by profiler | Datadog Continuous Profiler |
| `avg:datadog.profiling.node.heap_live_size{$service,$env}` | live heap size seen by profiler | Datadog Continuous Profiler |
| `sum:datadog.profiling.node.profiles{$service,$env}` | number of profile payloads sent | Datadog Continuous Profiler |

### Node.js Runtime Metrics

| Query Pattern | Meaning | Source |
|---|---|---|
| `avg:runtime.node.event_loop.delay.avg{$service,$env}` | event loop delay average | dd-trace runtime metrics |
| `avg:runtime.node.mem.heap_used{$service,$env}` | heap used | dd-trace runtime metrics |
| `avg:runtime.node.mem.heap_total{$service,$env}` | heap total | dd-trace runtime metrics |
| `avg:runtime.node.gc.pause.avg{$service,$env}` | GC pause average | dd-trace runtime metrics |
| `avg:runtime.node.active_handles{$service,$env}` | active handles | dd-trace runtime metrics |
| `avg:runtime.node.active_requests{$service,$env}` | active requests | dd-trace runtime metrics |
| `avg:runtime.node.mem.rss{$service,$env}` | process RSS memory | dd-trace runtime metrics |

### Host Metrics (Windows PDH Custom Counters)

These are emitted from `windows_performance_counters` mapping in bootstrap.

| Query Pattern | Meaning | Source |
|---|---|---|
| `avg:cpu.percent_processor_time{$env}` | CPU percent processor time | Datadog windows_performance_counters integration |
| `avg:memory.available_mbytes{$env}` | available memory MB | Datadog windows_performance_counters integration |
| `avg:disk.percent_free_space{$env}` | disk free space percent | Datadog windows_performance_counters integration |

### Host Metrics (Datadog Agent Built-In System)

| Query Pattern | Meaning | Source |
|---|---|---|
| `avg:system.cpu.user{$env}` | CPU user percent | Datadog system integration |
| `avg:system.cpu.system{$env}` | CPU system percent | Datadog system integration |
| `avg:system.mem.pct_usable{$env}` | usable memory ratio (0-1) | Datadog system integration |
| `avg:system.net.bytes_sent{$env}` | network bytes sent | Datadog system integration |
| `avg:system.net.bytes_rcvd{$env}` | network bytes received | Datadog system integration |

## Practical Validation Checklist

When adding new widgets, validate in this order:

1. Confirm service has traffic.
2. Confirm traces are ingested for service/env in APM.
3. Confirm metric exists in Metrics Explorer.
4. Confirm query returns points with hardcoded tags first.
5. Replace hardcoded tags with template variables (`{$service,$env}`).
6. Confirm template variable defaults match actual tags.

## Query Examples

Use these as copy-paste starters when creating new widgets.

### Example 1: Core API Health (same pattern as this dashboard)

```text
sum:trace.express.request.hits{$service,$env}.as_count()
sum:trace.express.request.errors{$service,$env}.as_count()
p95:trace.express.request{$service,$env}
avg:trace.express.request.apdex{$service,$env}
```

### Example 2: Endpoint Toplist

```text
sum:trace.express.request.hits{$service,$env} by {resource_name}.as_count()
p95:trace.express.request{$service,$env} by {resource_name}
sum:trace.express.request.errors{$service,$env} by {resource_name}.as_count()
```

### Example 3: Service Onboarding Walkthrough (new service)

Scenario:
- New service name: `orders-api`
- Environment: `staging`
- Framework: Express
- DB client: pg

Step A: hardcode tags first to verify data exists

```text
sum:trace.express.request.hits{service:orders-api,env:staging}.as_count()
p95:trace.express.request{service:orders-api,env:staging}
p95:trace.pg.query{service:orders-api,env:staging}
```

If these return data, the metric names are correct.

Step B: switch to template variables for reusable dashboard widgets

```text
sum:trace.express.request.hits{$service,$env}.as_count()
p95:trace.express.request{$service,$env}
p95:trace.pg.query{$service,$env}
```

Template variable setup required:

```json
{ "name": "env", "prefix": "env", "default": "staging" }
{ "name": "service", "prefix": "service", "default": "orders-api" }
```

Important:
- Correct with prefixed template variables: `{$service,$env}`
- Incorrect (double prefix bug): `{service:$service,env:$env}`

### Example 4: Runtime and Host Baseline

```text
avg:runtime.node.event_loop.delay.avg{$service,$env}
avg:runtime.node.mem.heap_used{$service,$env}
avg:system.cpu.user{$env}
avg:system.mem.pct_usable{$env}
```

Use this baseline when you want a minimal dashboard that includes app latency + runtime pressure + host capacity.

### Example 5: Non-Express Services (Fastify or plain http)

Use this when your service is not Express and you are unsure which span name to query.

#### Quick flow: verify span name first

1. Confirm which server/framework library your service uses (`fastify`, Node `http`, `koa`, etc.).
2. Check Datadog Node.js compatibility docs or dd-trace-js integrations list for that library.
3. In Datadog APM, filter by your `service` and `env`, then inspect span names from live traces.
4. Use the discovered span name in Metrics Explorer before creating dashboard widgets.

#### Fastify query starters (if span is `fastify.request`)

```text
sum:trace.fastify.request.hits{$service,$env}.as_count()
sum:trace.fastify.request.errors{$service,$env}.as_count()
p95:trace.fastify.request{$service,$env}
```

#### Plain Node HTTP query starters (if span is `http.request`)

```text
sum:trace.http.request.hits{$service,$env}.as_count()
sum:trace.http.request.errors{$service,$env}.as_count()
p95:trace.http.request{$service,$env}
```

Notes:
- The exact span name depends on the integration actually instrumenting your app.
- Do not assume Express naming (`trace.express.request`) for non-Express services.
- Validate with hardcoded tags first, then convert to template variables (`{$service,$env}`).

## Useful References

- Datadog dashboard query syntax and template variables:
  - https://docs.datadoghq.com/dashboards/querying/
  - https://docs.datadoghq.com/dashboards/template_variables/
- Datadog Node.js tracing and compatibility:
  - https://docs.datadoghq.com/tracing/trace_collection/automatic_instrumentation/dd_libraries/nodejs/
  - https://docs.datadoghq.com/tracing/trace_collection/compatibility/nodejs/
- dd-trace-js integrations source (span naming comes from integrations):
  - https://github.com/DataDog/dd-trace-js/tree/master/packages
- Datadog runtime metrics:
  - https://docs.datadoghq.com/tracing/metrics/runtime_metrics/
- Datadog Continuous Profiler:
  - https://docs.datadoghq.com/profiler/

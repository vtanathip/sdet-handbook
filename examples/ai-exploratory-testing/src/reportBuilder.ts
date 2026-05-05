import { readFile, readdir } from 'node:fs/promises';

export interface ReportInput {
  eventsPath: string;
  metricsPath: string;
  findingsPath: string;
  screenshotsDir?: string;
}

const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

interface JsonlRecord {
  [k: string]: unknown;
}

async function readJsonl(path: string): Promise<JsonlRecord[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as JsonlRecord);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function listScreenshots(dir: string | undefined): Promise<string[]> {
  if (!dir) return [];
  try {
    const files = await readdir(dir);
    return files.filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

function fmtDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function fmtBytes(n: unknown): string {
  if (typeof n !== 'number') return String(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

interface TurnNarrative {
  ts: string;
  content: string;
}

/** Pair each session.idle with the preceding assistant.message.data.content. */
function extractNarrative(events: JsonlRecord[]): TurnNarrative[] {
  const out: TurnNarrative[] = [];
  let lastMsg: { ts: string; content: string } | undefined;
  for (const e of events) {
    if (e.type === 'assistant.message') {
      const data = e.data as { content?: unknown } | undefined;
      const content = typeof data?.content === 'string' ? data.content : undefined;
      if (content) lastMsg = { ts: String(e.ts ?? ''), content };
    } else if (e.type === 'session.idle' && lastMsg) {
      out.push(lastMsg);
      lastMsg = undefined;
    }
  }
  return out;
}

function truncate(s: string, max = 240): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max - 1) + '…' : collapsed;
}

export async function buildReport(input: ReportInput): Promise<string> {
  const [events, metrics, findings, screenshots] = await Promise.all([
    readJsonl(input.eventsPath),
    readJsonl(input.metricsPath),
    readJsonl(input.findingsPath),
    listScreenshots(input.screenshotsDir),
  ]);

  const first = metrics[0];
  const last = metrics[metrics.length - 1];
  const heapRatio = first && last && typeof first.JSHeapUsedSize === 'number' && typeof last.JSHeapUsedSize === 'number'
    ? (last.JSHeapUsedSize / first.JSHeapUsedSize).toFixed(1)
    : 'n/a';

  const counts: Record<string, number> = {};
  let premiumRequests = 0;
  for (const e of events) {
    const type = String(e.type ?? '');
    counts[type] = (counts[type] ?? 0) + 1;
    if (type === 'session.shutdown' && typeof e.totalPremiumRequests === 'number')
      premiumRequests = e.totalPremiumRequests;
  }

  const firstEventTs = events[0]?.ts ? String(events[0].ts) : undefined;
  const lastEventTs = events[events.length - 1]?.ts ? String(events[events.length - 1].ts) : undefined;
  const duration = firstEventTs && lastEventTs ? fmtDuration(firstEventTs, lastEventTs) : 'n/a';

  const urls = Array.from(new Set(metrics.map((m) => String(m.url ?? '')).filter(Boolean)));
  const narrative = extractNarrative(events);

  const ranked = [...findings].sort((a, b) => {
    const s = (SEV_ORDER[String(a.severity)] ?? 9) - (SEV_ORDER[String(b.severity)] ?? 9);
    return s !== 0 ? s : String(a.ts).localeCompare(String(b.ts));
  });

  const lines: string[] = [
    `# Run report`,
    ``,
    `## Overview`,
    `- Duration: ${duration}${firstEventTs && lastEventTs ? ` (${firstEventTs} → ${lastEventTs})` : ''}`,
    `- Events: ${events.length}  |  Metric samples: ${metrics.length}  |  Findings: ${findings.length}  |  Screenshots: ${screenshots.length}`,
    ``,
    `## URLs visited (${urls.length})`,
    ...(urls.length === 0 ? ['- (none — sampler may not have started)'] : urls.map((u) => `- ${u}`)),
    ``,
    `## What the agent did (${narrative.length} turn${narrative.length === 1 ? '' : 's'})`,
    ...(narrative.length === 0
      ? ['- (no assistant messages captured)']
      : narrative.map((n, i) => `${i + 1}. \`${n.ts}\` — ${truncate(n.content)}`)),
    ``,
    `## Metrics trend`,
    first
      ? `- Start JSHeapUsedSize: ${first.JSHeapUsedSize} (${fmtBytes(first.JSHeapUsedSize)})`
      : `- No metric samples captured.`,
    last ? `- End JSHeapUsedSize:   ${last.JSHeapUsedSize} (${fmtBytes(last.JSHeapUsedSize)})` : ``,
    first && last ? `- Heap growth ratio:   ${heapRatio}x` : ``,
    first && last ? `- Nodes:   ${first.Nodes} → ${last.Nodes}` : ``,
    first && last ? `- Listeners: ${first.JSEventListeners} → ${last.JSEventListeners}` : ``,
    ``,
    `## Findings (${findings.length})`,
    ...(findings.length === 0
      ? ['- (none — agent filed no bug reports)']
      : ranked.map((f) => `- **${f.severity}** — ${f.title} (conf: ${f.agentConfidence}, ${f.ts})`)),
    ``,
    `## Evidence (${screenshots.length} screenshots)`,
    ...(screenshots.length === 0
      ? ['- (none captured)']
      : screenshots.map((s) => `- ${s}`)),
    ``,
    `## Session events`,
    ...Object.entries(counts).sort().map(([t, n]) => `- ${t}: ${n}`),
    `- premiumRequests: ${premiumRequests}`,
    ``,
  ];

  return lines.join('\n');
}

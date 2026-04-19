import fs from "fs";
import path from "path";
import os from "os";
import type {
  DayEntry,
  DashboardData,
  Session,
  StorageCategory,
  ClaudeJsonlEntry,
} from "../types/index.js";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

interface UsageRecord {
  sessionId: string;
  project: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  timestamp: number;
  filePath: string;
  fileSize: number;
}

function walkDir(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full, ext));
    else if (ext === "" || entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

function dirSizeStats(dir: string): { sizeMB: number; files: number } {
  if (!fs.existsSync(dir)) return { sizeMB: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  for (const f of walkDir(dir, "")) {
    try { bytes += fs.statSync(f).size; files++; } catch {}
  }
  return { sizeMB: bytes / 1024 / 1024, files };
}

function parseProjectName(projectDir: string): string {
  const name = path.basename(projectDir);
  try {
    return decodeURIComponent(name.replace(/-/g, "/"));
  } catch {
    return name;
  }
}

function readUsageRecords(): UsageRecord[] {
  if (!fs.existsSync(CLAUDE_DIR)) return [];
  const jsonlFiles = walkDir(PROJECTS_DIR, ".jsonl");
  const records: UsageRecord[] = [];

  for (const filePath of jsonlFiles) {
    let stat: fs.Stats;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const projectDir = path.dirname(filePath);
    const project = parseProjectName(projectDir);
    let lines: string[];
    try { lines = fs.readFileSync(filePath, "utf8").split("\n"); } catch { continue; }

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry: ClaudeJsonlEntry = JSON.parse(line);
        if (entry.type !== "assistant" || !entry.message?.usage) continue;

        const usage = entry.message.usage;
        records.push({
          sessionId: entry.sessionId ?? filePath,
          project,
          model: entry.message.model ?? "unknown",
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cachedTokens: usage.cache_read_input_tokens ?? 0,
          timestamp: stat.mtimeMs,
          filePath,
          fileSize: stat.size,
        });
      } catch {}
    }
  }

  return records;
}

function buildDailyEntries(records: UsageRecord[], referenceDate: string): DayEntry[] {
  const byDate = new Map<string, { input: number; output: number }>();

  for (const r of records) {
    const d = new Date(r.timestamp);
    const key = d.toISOString().slice(0, 10);
    const prev = byDate.get(key) ?? { input: 0, output: 0 };
    byDate.set(key, {
      input: prev.input + r.inputTokens,
      output: prev.output + r.outputTokens,
    });
  }

  // Build 30 days ending on referenceDate
  const days: DayEntry[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(referenceDate + "T00:00:00");
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const usage = byDate.get(key) ?? { input: 0, output: 0 };
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    days.push({ label, shortLabel: label, date: key, ...usage, total: usage.input + usage.output });
  }
  return days;
}

function buildWeeklyEntries(daily: DayEntry[]): DayEntry[] {
  const weeks: DayEntry[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    const input = chunk.reduce((s, d) => s + d.input, 0);
    const output = chunk.reduce((s, d) => s + d.output, 0);
    const label = chunk[0]?.label ?? `W${Math.floor(i / 7) + 1}`;
    weeks.push({ label, shortLabel: label, date: chunk[0]?.date ?? "", input, output, total: input + output });
  }
  return weeks;
}

function buildSessions(records: UsageRecord[]): Session[] {
  const grouped = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const arr = grouped.get(r.sessionId) ?? [];
    arr.push(r);
    grouped.set(r.sessionId, arr);
  }

  const sessions: Session[] = [];
  for (const [sessionId, recs] of grouped) {
    const first = recs[0];
    const last = recs[recs.length - 1];
    const totalInput = recs.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutput = recs.reduce((s, r) => s + r.outputTokens, 0);
    const totalCached = recs.reduce((s, r) => s + r.cachedTokens, 0);

    const startMs = Math.min(...recs.map((r) => r.timestamp));
    const endMs = Math.max(...recs.map((r) => r.timestamp));
    const durationMin = Math.round((endMs - startMs) / 60000);
    const duration = durationMin < 60
      ? `${durationMin}m`
      : `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`;

    const startedAt = new Date(startMs).toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });

    const modelRaw = last.model.replace("claude-", "");
    const model = modelRaw.includes("opus") ? "opus" : modelRaw.includes("haiku") ? "haiku" : "sonnet";

    const uniquePaths = [...new Set(recs.map((r) => r.filePath))];
    const files = uniquePaths.map((fp) => {
      try { return { path: fp, sizeKB: Math.round(fs.statSync(fp).size / 1024) }; }
      catch { return { path: fp, sizeKB: 0 }; }
    });

    const shortId = sessionId.slice(0, 8);
    sessions.push({
      id: shortId,
      name: `Session ${shortId}`,
      model,
      project: first.project,
      startedAt,
      duration,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cachedTokens: totalCached,
      files,
    });
  }

  return sessions
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
    .slice(0, 50);
}

function buildStorageCategories(): StorageCategory[] {
  const cacheDir = path.join(CLAUDE_DIR, "cache");
  const logsDir = path.join(CLAUDE_DIR, "logs");

  const conversations = dirSizeStats(PROJECTS_DIR);
  const cache = dirSizeStats(cacheDir);
  const logs = dirSizeStats(logsDir);

  const otherFiles = walkDir(CLAUDE_DIR, "").filter(
    (f) => !f.startsWith(PROJECTS_DIR) && !f.startsWith(cacheDir) && !f.startsWith(logsDir)
  );
  const otherBytes = otherFiles.reduce((s, f) => {
    try { return s + fs.statSync(f).size; } catch { return s; }
  }, 0);

  return [
    { key: "conversations", name: "Conversations", sizeMB: conversations.sizeMB, files: conversations.files, color: "#0A0A0A" },
    { key: "cache",         name: "Cache",         sizeMB: cache.sizeMB,         files: cache.files,         color: "#CC785C" },
    { key: "logs",          name: "Logs",           sizeMB: logs.sizeMB,          files: logs.files,          color: "#6B8E5A" },
    { key: "other",         name: "Other",          sizeMB: otherBytes / 1024 / 1024, files: otherFiles.length, color: "#9A9A97" },
  ].filter((c) => c.files > 0 || c.sizeMB > 0);
}

export function readDashboardData(referenceDate?: string): DashboardData {
  const date = referenceDate ?? new Date().toISOString().slice(0, 10);
  const records = readUsageRecords();
  const daily = buildDailyEntries(records, date);
  const weekly = buildWeeklyEntries(daily);
  const sessions = buildSessions(records);
  const storageCategories = buildStorageCategories();

  return { DAILY: daily, WEEKLY: weekly, STORAGE_CATEGORIES: storageCategories, SESSIONS: sessions };
}

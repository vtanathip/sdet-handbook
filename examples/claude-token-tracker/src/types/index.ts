export interface DayEntry {
  label: string;
  shortLabel: string;
  date: string;
  input: number;
  output: number;
  total: number;
}

export interface StorageCategory {
  key: string;
  name: string;
  sizeMB: number;
  files: number;
  color: string;
}

export interface SessionFile {
  path: string;
  sizeKB: number;
}

export interface Session {
  id: string;
  name: string;
  model: string;
  project: string;
  startedAt: string;
  duration: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  files: SessionFile[];
}

export interface DashboardData {
  DAILY: DayEntry[];
  WEEKLY: DayEntry[];
  STORAGE_CATEGORIES: StorageCategory[];
  SESSIONS: Session[];
}

export interface FileNode {
  name: string;
  relativePath: string;
  type: "file" | "dir";
  sizeMB: number;
  fileCount: number;
  children?: FileNode[];
}

export interface ClaudeMessageUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ClaudeJsonlEntry {
  type: "user" | "assistant" | "system";
  sessionId?: string;
  cwd?: string;
  message?: {
    role?: string;
    model?: string;
    usage?: ClaudeMessageUsage;
    content?: unknown;
  };
}

import fs from "fs";
import path from "path";
import os from "os";
import type { FileNode } from "../types/index.js";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const MAX_DEPTH = 3;

function scanNode(fullPath: string, relativePath: string, depth: number): FileNode {
  const name = path.basename(fullPath);
  let stat: fs.Stats;
  try { stat = fs.statSync(fullPath); } catch {
    return { name, relativePath, type: "file", sizeMB: 0, fileCount: 0 };
  }

  if (!stat.isDirectory()) {
    return { name, relativePath, type: "file", sizeMB: stat.size / 1024 / 1024, fileCount: 1 };
  }

  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(fullPath, { withFileTypes: true }); } catch {}

  const children: FileNode[] = depth < MAX_DEPTH
    ? entries
        .map(e => scanNode(path.join(fullPath, e.name), path.join(relativePath, e.name), depth + 1))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return b.sizeMB - a.sizeMB;
        })
    : [];

  const sizeMB = children.length > 0
    ? children.reduce((s, c) => s + c.sizeMB, 0)
    : entries.reduce((s, e) => {
        try { return s + fs.statSync(path.join(fullPath, e.name)).size / 1024 / 1024; } catch { return s; }
      }, 0);

  const fileCount = children.length > 0
    ? children.reduce((s, c) => s + c.fileCount, 0)
    : entries.filter(e => e.isFile()).length;

  return { name, relativePath, type: "dir", sizeMB, fileCount, children };
}

export function scanClaudeDir(): FileNode {
  if (!fs.existsSync(CLAUDE_DIR)) {
    return { name: ".claude", relativePath: "", type: "dir", sizeMB: 0, fileCount: 0, children: [] };
  }
  return scanNode(CLAUDE_DIR, "", 0);
}

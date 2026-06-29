import { SourceMap } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve a "url:line:col" code location back to its ORIGINAL source via adjacent source maps, at
// report time. Against a bundled app every captured location points into vendor.js / index-abc123.js;
// this turns it back into src/cart.ts:212. Zero observer-effect — pure post-processing of strings the
// detectors already captured. Best-effort: returns the input unchanged when there's no map (unbundled
// app, missing .map, or a non-file:// URL).
//
// ponytail: file:// only — that covers source-launched and most packaged Electron renderers. A dev
// server (http://localhost) would need a URL-prefix→dist-dir mapping; add a SOURCEMAP_BASE knob if a
// real app needs it. Don't pull in the `source-map` npm package — node:module SourceMap is stdlib.

type Loc = { url: string; line: number; col: number };

// Peel the trailing :line:col (or :line) off the END — the URL itself contains colons (file:///,
// http://host:port), so match the last one or two numeric groups, not the first colon.
export function splitLocation(s: string): Loc | undefined {
  const t = s.trim();
  let m = /^(.+):(\d+):(\d+)$/.exec(t);
  if (m) return { url: m[1], line: Number(m[2]), col: Number(m[3]) };
  m = /^(.+):(\d+)$/.exec(t);
  if (m) return { url: m[1], line: Number(m[2]), col: 0 };
  return undefined;
}

const cache = new Map<string, SourceMap | null>(); // by generated URL; null = looked, none found

function mapFor(generatedUrl: string): SourceMap | null {
  const hit = cache.get(generatedUrl);
  if (hit !== undefined) return hit;
  let sm: SourceMap | null = null;
  try {
    if (generatedUrl.startsWith('file://')) {
      const p = fileURLToPath(generatedUrl);
      if (existsSync(p + '.map')) {
        sm = new SourceMap(JSON.parse(readFileSync(p + '.map', 'utf8')));
      } else if (existsSync(p)) {
        // inline //# sourceMappingURL=data:application/json;base64,...
        const inline = /\/\/[#@]\s*sourceMappingURL=data:application\/json[^,]*?base64,([A-Za-z0-9+/=]+)/.exec(readFileSync(p, 'utf8'));
        if (inline) sm = new SourceMap(JSON.parse(Buffer.from(inline[1], 'base64').toString('utf8')));
      }
    }
  } catch {
    sm = null; // malformed map must never break report generation
  }
  cache.set(generatedUrl, sm);
  return sm;
}

function cleanSource(s: string): string {
  return s.replace(/^webpack:\/\/[^/]*\//, '').replace(/^\.\//, '');
}

// Resolve a location that may carry a "name @ " prefix (L8 initiator) or be bare (jsErrors topFrame).
// Returns the original source location, preserving the prefix, or the input unchanged on any miss.
export function resolveLoc(s: string): string {
  const at = s.lastIndexOf(' @ ');
  const prefix = at >= 0 ? s.slice(0, at + 3) : '';
  const loc = splitLocation(at >= 0 ? s.slice(at + 3) : s);
  if (!loc) return s;
  const sm = mapFor(loc.url);
  if (!sm) return s;
  try {
    // findEntry returns {} on a miss; type it loose so the empty case is accessible.
    const e = sm.findEntry(Math.max(0, loc.line - 1), loc.col > 0 ? loc.col - 1 : 0) as
      { originalSource?: string; originalLine?: number; originalColumn?: number }; // 0-based in & out
    if (!e.originalSource) return s;
    return `${prefix}${cleanSource(e.originalSource)}:${(e.originalLine ?? 0) + 1}:${(e.originalColumn ?? 0) + 1}`;
  } catch {
    return s;
  }
}

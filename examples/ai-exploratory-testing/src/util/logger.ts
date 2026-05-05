export function log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
}

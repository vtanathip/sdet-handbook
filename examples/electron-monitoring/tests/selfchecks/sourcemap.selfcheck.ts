import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitLocation, resolveLoc } from '../../src/util/sourcemap.js';

// Source-map resolution: the trailing :line:col is peeled correctly even when the URL has its own
// colons, and a real on-disk .map turns a generated location back into its original source.
export function run(): void {
  // splitLocation: don't get fooled by colons inside file:// / http://host:port URLs.
  assert.deepEqual(splitLocation('file:///a/app.js:212:9'), { url: 'file:///a/app.js', line: 212, col: 9 });
  assert.deepEqual(splitLocation('http://localhost:3000/app.js:5:1'), { url: 'http://localhost:3000/app.js', line: 5, col: 1 });
  assert.deepEqual(splitLocation('app.js:212'), { url: 'app.js', line: 212, col: 0 });
  assert.equal(splitLocation('no-location-here'), undefined);

  // End-to-end: a generated file + its .map mapping generated (line1,col1) → original src/cart.ts.
  // "AAAA" is one segment at generated column 0 → source[0], original line 0, original column 0.
  const dir = mkdtempSync(join(tmpdir(), 'em-sourcemap-'));
  writeFileSync(join(dir, 'bundle.js'), 'console.log(1)\n');
  writeFileSync(join(dir, 'bundle.js.map'),
    JSON.stringify({ version: 3, sources: ['src/cart.ts'], names: [], mappings: 'AAAA' }));
  const url = pathToFileURL(join(dir, 'bundle.js')).href;

  const resolved = resolveLoc(`${url}:1:1`);
  assert.equal(resolved, 'src/cart.ts:1:1', `bare topFrame should resolve, got: ${resolved}`);

  // The "name @ " prefix (L8 initiator shape) is preserved, the location part resolved.
  const withPrefix = resolveLoc(`loadCart @ ${url}:1:1`);
  assert.equal(withPrefix, 'loadCart @ src/cart.ts:1:1', `initiator prefix should survive, got: ${withPrefix}`);

  // No map / non-file URL / unparseable → returned unchanged (best-effort, never throws).
  assert.equal(resolveLoc('https://cdn.example.com/x.js:9:9'), 'https://cdn.example.com/x.js:9:9');
  assert.equal(resolveLoc('just a message'), 'just a message');
}

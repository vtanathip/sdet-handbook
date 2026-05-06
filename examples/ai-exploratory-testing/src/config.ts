import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

export const ConfigSchema = z.object({
  appUrl: z.url(),
  persona: z.string().min(1),
  loopIntent: z.string().min(1),
  runDurationHours: z.number().positive(),
  samplerIntervalSec: z.number().int().positive().default(30),
  stuckDetectorSec: z.number().int().positive().default(120),
  seedNotes: z.string().optional(),
  headed: z.boolean().optional(),
  authStateFile: z.string().optional(),
  authLoginHint: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string): Config {
  const raw = parseYaml(readFileSync(path, 'utf8'));
  return ConfigSchema.parse(raw);
}

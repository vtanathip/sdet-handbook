import { existsSync } from 'node:fs';

export type AuthMode = 'no-auth' | 'reuse' | 'login-then-save';

export function resolveAuthMode(authStateFile: string | undefined): AuthMode {
  if (!authStateFile) return 'no-auth';
  return existsSync(authStateFile) ? 'reuse' : 'login-then-save';
}

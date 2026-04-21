import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Required env var "${name}" is not set. Copy .env.example to .env and fill in values.`,
    );
  }
  return value;
}

export const accounts = {
  admin: {
    email: requireEnv('TEST_USER_ADMIN_EMAIL'),
    password: requireEnv('TEST_USER_ADMIN_PASSWORD'),
    role: 'admin' as const,
  },
  viewer: {
    email: requireEnv('TEST_USER_VIEWER_EMAIL'),
    password: requireEnv('TEST_USER_VIEWER_PASSWORD'),
    role: 'viewer' as const,
  },
  editor: {
    email: requireEnv('TEST_USER_EDITOR_EMAIL'),
    password: requireEnv('TEST_USER_EDITOR_PASSWORD'),
    role: 'editor' as const,
  },
};

export type AccountRole = keyof typeof accounts;

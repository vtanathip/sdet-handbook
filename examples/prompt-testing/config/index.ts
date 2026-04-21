import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`"${name}" is not set. Copy .env.example to .env and fill in values.`);
  return value;
}

export const config = {
  baseUrl: requireEnv('BASE_URL'),
  user: {
    email: requireEnv('TEST_USER_EMAIL'),
    password: requireEnv('TEST_USER_PASSWORD'),
  },
};

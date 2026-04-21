import 'dotenv/config';

const environments = {
  staging: {
    baseUrl: process.env.BASE_URL || 'https://staging.your-app.com',
    loginPath: '/auth/login',
    dashboardPath: '/dashboard',
    usersPath: '/admin/users',
    timeouts: { navigation: 30_000, api: 10_000 },
  },
  uat: {
    baseUrl: process.env.BASE_URL || 'https://uat.your-app.com',
    loginPath: '/auth/login',
    dashboardPath: '/dashboard',
    usersPath: '/admin/users',
    timeouts: { navigation: 45_000, api: 15_000 },
  },
  prod: {
    baseUrl: process.env.BASE_URL || 'https://your-app.com',
    loginPath: '/auth/login',
    dashboardPath: '/dashboard',
    usersPath: '/admin/users',
    timeouts: { navigation: 60_000, api: 20_000 },
  },
} as const;

export type Environment = keyof typeof environments;

const envKey = (process.env.TEST_ENV as Environment) || 'staging';

if (!environments[envKey]) {
  throw new Error(
    `Unknown TEST_ENV: "${envKey}". Valid values: ${Object.keys(environments).join(', ')}`,
  );
}

export const config = environments[envKey];

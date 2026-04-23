# config/index.ts

## Purpose
Single source of truth for runtime configuration. Reads environment variables and exposes a typed `config` object used across all modules.

## Exports

### `config`
```ts
export const config = {
  baseUrl: string,        // BASE_URL env var — target application URL
  user: {
    email: string,        // TEST_USER_EMAIL env var
    password: string,     // TEST_USER_PASSWORD env var
  }
}
```

## Behaviour
- Calls `requireEnv()` for each key — throws at startup with a descriptive message if any variable is missing rather than silently failing mid-test.
- `dotenv/config` is imported so `.env` files are loaded automatically before any value is read.

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `BASE_URL` | Yes | Root URL of the application under test |
| `TEST_USER_EMAIL` | Yes | Email used in login steps |
| `TEST_USER_PASSWORD` | Yes | Password used in login steps |

# src/ai/azure-client.ts

## Purpose
Thin wrapper around the Azure OpenAI SDK. Provides two typed functions that cover the two cost/capability tiers used by the AI pipeline.

## Exports

### `chatMini(messages): Promise<string>`
Fast, low-cost call backed by **GPT-4o-mini**. Used for intent classification and DOM-based locator resolution.

| Parameter | Type | Description |
|---|---|---|
| `messages` | `ChatMessage[]` | System + user message array |

- `response_format: { type: 'json_object' }` is always set — the model is forced to return valid JSON.
- `temperature: 0` ensures deterministic output.

### `chatFull(messages, screenshotBase64?): Promise<string>`
Full GPT-4o call for vision and complex element resolution. Accepts an optional base64-encoded PNG screenshot.

| Parameter | Type | Description |
|---|---|---|
| `messages` | `ChatMessage[]` | System + user message array |
| `screenshotBase64` | `string?` | Base64 PNG; appended as an `image_url` content part to the last user message |

### `ChatMessage` interface
```ts
interface ChatMessage {
  role: 'system' | 'user';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}
```

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | — (required) | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_API_KEY` | — (required) | API key |
| `AZURE_OPENAI_API_VERSION` | `2024-05-01-preview` | API version |
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-4o` | Full-model deployment name |
| `AZURE_OPENAI_MINI_DEPLOYMENT` | `gpt-4o-mini` | Mini-model deployment name |

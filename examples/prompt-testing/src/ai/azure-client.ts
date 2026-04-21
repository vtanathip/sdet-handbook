import 'dotenv/config';
import { AzureOpenAI } from '@azure/openai';

const endpoint = process.env.AZURE_OPENAI_ENDPOINT!;
const apiKey = process.env.AZURE_OPENAI_API_KEY!;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-05-01-preview';

const fullDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
const miniDeployment = process.env.AZURE_OPENAI_MINI_DEPLOYMENT || 'gpt-4o-mini';

if (!endpoint || !apiKey) {
  throw new Error(
    'AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set. Copy .env.example to .env.',
  );
}

function makeClient(deployment: string) {
  return new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

/** Fast/cheap call for intent classification and simple DOM resolution */
export async function chatMini(messages: ChatMessage[]): Promise<string> {
  const client = makeClient(miniDeployment);
  const response = await client.chat.completions.create({
    model: miniDeployment,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  return response.choices[0]?.message?.content ?? '{}';
}

/** Full GPT-4o call for vision and complex element resolution */
export async function chatFull(messages: ChatMessage[], screenshotBase64?: string): Promise<string> {
  const client = makeClient(fullDeployment);

  if (screenshotBase64) {
    const lastUser = messages[messages.length - 1];
    if (lastUser.role === 'user' && typeof lastUser.content === 'string') {
      lastUser.content = [
        { type: 'text', text: lastUser.content },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
      ];
    }
  }

  const response = await client.chat.completions.create({
    model: fullDeployment,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  return response.choices[0]?.message?.content ?? '{}';
}

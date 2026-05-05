import {
  CopilotClient,
  CopilotSession,
  approveAll,
  type SessionEvent,
} from '@github/copilot-sdk';
import { log } from './util/logger.js';

export interface SessionRunnerOpts {
  systemPrompt: string;
  skillDirectories: string[];
  model?: string;
}

export class SessionRunner {
  private constructor(
    public readonly session: CopilotSession,
    public readonly client: CopilotClient,
  ) {}

  static async create(opts: SessionRunnerOpts): Promise<SessionRunner> {
    const client = new CopilotClient();
    const session = await client.createSession({
      model: opts.model,
      onPermissionRequest: approveAll,
      skillDirectories: opts.skillDirectories,
      systemMessage: { mode: 'append', content: opts.systemPrompt },
    });
    return new SessionRunner(session, client);
  }

  on(handler: (e: SessionEvent) => void): () => void {
    return this.session.on(handler);
  }

  async sendAndWait(prompt: string, timeoutMs = 300_000): Promise<void> {
    await this.session.sendAndWait({ prompt }, timeoutMs);
  }

  async abort(): Promise<void> {
    try { await this.session.abort(); }
    catch (err) { log('warn', 'abort failed', err); }
  }

  async disconnect(): Promise<void> {
    try { await this.session.disconnect(); }
    catch (err) { log('warn', 'session.disconnect failed', err); }
  }

  /** Fully tears down: disconnect session(s) + kill the CLI subprocess + close sockets. */
  async stop(): Promise<void> {
    const errors = await this.client.stop();
    if (errors.length > 0) {
      for (const e of errors) log('warn', 'client.stop error', e);
    }
  }
}

import { createWriteStream, type WriteStream } from 'node:fs';

// Copied verbatim from examples/ai-exploratory-testing/src/util/jsonl.ts — append-only,
// serialized writes so concurrent detectors never interleave a line.
export class JsonlWriter {
  private stream: WriteStream;
  private queue: Promise<void> = Promise.resolve();
  constructor(path: string) {
    this.stream = createWriteStream(path, { flags: 'a' });
  }
  append(record: unknown): Promise<void> {
    this.queue = this.queue.then(
      () => new Promise<void>((resolve, reject) => {
        this.stream.write(JSON.stringify(record) + '\n', (err) =>
          err ? reject(err) : resolve());
      }),
    );
    return this.queue;
  }
  async close(): Promise<void> {
    await this.queue;
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}

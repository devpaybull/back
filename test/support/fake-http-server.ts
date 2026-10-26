import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

export type FakeHandler = (
  path: string,
  body: Record<string, unknown>,
  request: IncomingMessage,
) => { status: number; body: unknown };

export class FakeHttpServer {
  private server: Server | null = null;
  requests: { path: string; body: Record<string, unknown> }[] = [];

  constructor(private readonly handler: FakeHandler) {}

  get url(): string {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  private port = 0;

  async start(): Promise<void> {
    this.server = createServer(
      (request, response) => void this.handle(request, response),
    );
    await new Promise<void>((resolve) =>
      this.server!.listen(this.port, '127.0.0.1', resolve),
    );
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<
          string,
          unknown
        >)
      : {};
    const path = (request.url ?? '').replace(/^\//, '');
    this.requests.push({ path, body });
    const reply = this.handler(path, body, request);
    response.writeHead(reply.status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(reply.body));
  }
}

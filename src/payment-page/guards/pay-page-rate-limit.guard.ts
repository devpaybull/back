import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { clientKeyOf } from '../utils/client-key-of';

const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 100_000;

interface ClientWindow {
  startedAt: number;
  count: number;
}

@Injectable()
export class PayPageRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, ClientWindow>();
  private sweptAt = 0;

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const now = Date.now();

    this.sweep(now);

    const client = clientKeyOf(request.ip);
    const current = this.windows.get(client);
    const window =
      current && now - current.startedAt < WINDOW_MS
        ? current
        : { startedAt: now, count: 0 };

    window.count += 1;
    if (window !== current) this.open(client, window);

    if (window.count <= this.limit()) return true;

    http
      .getResponse<Response>()
      .setHeader(
        'Retry-After',
        String(Math.ceil((window.startedAt + WINDOW_MS - now) / 1000)),
      );

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests; try again in a minute',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private limit(): number {
    return this.config.getOrThrow<number>('PAY_PAGE_RATE_LIMIT_PER_MINUTE');
  }

  private open(client: string, window: ClientWindow): void {
    this.windows.delete(client);

    if (this.windows.size >= MAX_TRACKED_CLIENTS) {
      const oldest = this.windows.keys().next().value;

      if (oldest !== undefined) this.windows.delete(oldest);
    }

    this.windows.set(client, window);
  }

  private sweep(now: number): void {
    if (now - this.sweptAt < WINDOW_MS) return;

    this.sweptAt = now;
    for (const [client, window] of this.windows) {
      if (now - window.startedAt < WINDOW_MS) return;
      this.windows.delete(client);
    }
  }
}

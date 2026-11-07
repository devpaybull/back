import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { MerchantCallback } from '../entities/merchant-callback.entity';
import {
  CallbackHttpClient,
  CallbackUrlRefusedError,
} from '../types/callback-http-client';
import { CallbackAttemptOutcome } from '../types/callback-attempt-outcome';
import { MerchantCallbackStatus } from '../types/merchant-callback-status.enum';
import { callbackSignature } from '../utils/callback-signature';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const RETENTION_INTERVAL_MS = 60 * MINUTE_MS;
const BACKOFF_MINUTES = [1, 2, 4, 8, 16, 32, 60, 60, 60];
const RESPONSE_BODY_MAX = 2048;
const NO_KEY = 'The merchant has no active API key to sign with';
const LEASE_FACTOR = 2;
const NUL = '\u0000';
const CRASHED_OUT = 'The last attempts ended without a result';

@Injectable()
export class MerchantCallbackSenderService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MerchantCallbackSenderService.name);
  private timer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(MerchantCallback)
    private readonly callbacks: Repository<MerchantCallback>,
    private readonly merchants: MerchantsService,
    private readonly http: CallbackHttpClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const seconds = this.config.get<number>(
      'MERCHANT_CALLBACK_INTERVAL_SECONDS',
    );

    this.timer = setInterval(() => void this.run(), seconds * 1000);
    this.timer.unref();
    this.retentionTimer = setInterval(
      () => void this.removeExpired(),
      RETENTION_INTERVAL_MS,
    );
    this.retentionTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.timer = null;
    this.retentionTimer = null;
  }

  async run(now: () => Date = () => new Date()): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      let claimed: MerchantCallback[];

      do {
        claimed = await this.claim(now());
        await Promise.allSettled(claimed.map((row) => this.deliver(row, now)));
      } while (claimed.length > 0);
    } catch (error) {
      this.logger.error(
        `Sending callbacks failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  async removeExpired(now: Date = new Date()): Promise<number> {
    const days = this.config.getOrThrow<number>(
      'MERCHANT_CALLBACK_RETENTION_DAYS',
    );

    try {
      const result = await this.callbacks.delete({
        createdAt: LessThan(new Date(now.getTime() - days * DAY_MS)),
        status: Not(
          In([MerchantCallbackStatus.Pending, MerchantCallbackStatus.Retrying]),
        ),
      });

      return result.affected ?? 0;
    } catch (error) {
      this.logger.error(
        `Callbacks cleanup failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return 0;
    }
  }

  private claim(now: Date): Promise<MerchantCallback[]> {
    const timeoutMs = this.config.getOrThrow<number>(
      'MERCHANT_CALLBACK_TIMEOUT_MS',
    );

    return this.callbacks.manager.transaction(async (manager) => {
      const rows = await manager
        .getRepository(MerchantCallback)
        .createQueryBuilder('callback')
        .where('callback.status IN (:...open)', {
          open: [
            MerchantCallbackStatus.Pending,
            MerchantCallbackStatus.Retrying,
          ],
        })
        .andWhere('callback.nextAttemptAt <= :now', { now })
        .andWhere(
          `(callback."isResend" OR NOT EXISTS (
            SELECT 1 FROM merchant_callbacks earlier
            WHERE earlier."transactionId" = callback."transactionId"
              AND NOT earlier."isResend"
              AND earlier."eventSeq" < callback."eventSeq"
              AND earlier.status IN ('pending', 'retrying')
          ))`,
        )
        .orderBy('callback.nextAttemptAt', 'ASC')
        .addOrderBy('callback.eventSeq', 'ASC')
        .take(this.config.getOrThrow<number>('MERCHANT_CALLBACK_CONCURRENCY'))
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      const spent = rows.filter((row) => row.attempts >= this.maxAttempts);

      for (const row of spent) {
        row.status = MerchantCallbackStatus.Failed;
        row.lastError = CRASHED_OUT;
        row.nextAttemptAt = null;
      }

      const sendable = rows.filter((row) => !spent.includes(row));

      for (const row of sendable) {
        row.attempts += 1;
        row.lastAttemptAt = now;
        row.status = MerchantCallbackStatus.Retrying;
        row.nextAttemptAt = new Date(now.getTime() + timeoutMs * LEASE_FACTOR);
      }

      if (rows.length) await manager.save(rows);

      return sendable;
    });
  }

  private async deliver(row: MerchantCallback, now: () => Date): Promise<void> {
    const outcome = await this.attempt(row, now);

    try {
      await this.callbacks.update(
        {
          id: row.id,
          attempts: row.attempts,
          status: MerchantCallbackStatus.Retrying,
        },
        outcome,
      );
    } catch (error) {
      this.logger.error(
        `Recording callback ${row.id} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async attempt(
    row: MerchantCallback,
    now: () => Date,
  ): Promise<CallbackAttemptOutcome> {
    try {
      const secret = (await this.merchants.newestActiveKey(row.merchantId))
        ?.secret;

      if (!secret) return this.failure(NO_KEY);

      const body = JSON.stringify(row.payload);
      const timestamp = String(Math.floor(now().getTime() / 1000));
      const response = await this.http.post(
        row.url as string,
        body,
        {
          'Content-Type': 'application/json',
          'X-Signature': callbackSignature(secret, timestamp, body),
          'X-Timestamp': timestamp,
          'X-Event-Id': row.eventId,
        },
        this.config.getOrThrow<number>('MERCHANT_CALLBACK_TIMEOUT_MS'),
      );
      const answered = {
        lastResponseCode: response.statusCode,
        lastResponseBody: response.body
          .split(NUL)
          .join('')
          .slice(0, RESPONSE_BODY_MAX),
      };

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return {
          ...answered,
          lastError: null,
          status: MerchantCallbackStatus.Delivered,
          nextAttemptAt: null,
        };
      }

      return {
        ...answered,
        ...this.nextTry(row, `Answered ${response.statusCode}`, now()),
      };
    } catch (error) {
      return error instanceof CallbackUrlRefusedError
        ? this.failure(error.message)
        : this.nextTry(row, (error as Error).message, now());
    }
  }

  private nextTry(
    row: MerchantCallback,
    reason: string,
    now: Date,
  ): CallbackAttemptOutcome {
    if (row.attempts >= this.maxAttempts) return this.failure(reason);

    const minutes =
      BACKOFF_MINUTES[Math.min(row.attempts - 1, BACKOFF_MINUTES.length - 1)];

    return {
      status: MerchantCallbackStatus.Retrying,
      lastError: reason.split(NUL).join(''),
      nextAttemptAt: new Date(now.getTime() + minutes * MINUTE_MS),
    };
  }

  private failure(reason: string): CallbackAttemptOutcome {
    return {
      status: MerchantCallbackStatus.Failed,
      lastError: reason.split(NUL).join(''),
      nextAttemptAt: null,
    };
  }

  private get maxAttempts(): number {
    return this.config.getOrThrow<number>('MERCHANT_CALLBACK_MAX_ATTEMPTS');
  }
}

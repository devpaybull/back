import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import {
  Between,
  EntityManager,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { Page, toPage } from '../../common/types/page';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { MerchantCallback } from '../entities/merchant-callback.entity';
import { EnqueueMerchantCallback } from '../types/enqueue-merchant-callback';
import { MerchantCallbackListQuery } from '../types/merchant-callback-list-query';
import { MerchantCallbackStatus } from '../types/merchant-callback-status.enum';

const RESEND_INTERVAL_MS = 60_000;
const RESENDABLE: readonly MerchantCallbackStatus[] = [
  MerchantCallbackStatus.Delivered,
  MerchantCallbackStatus.Failed,
];

const createdRange = (from?: Date, to?: Date) => {
  if (from && to) return Between(from, to);
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThanOrEqual(to);

  return undefined;
};

@Injectable()
export class MerchantCallbacksService {
  constructor(
    @InjectRepository(MerchantCallback)
    private readonly callbacks: Repository<MerchantCallback>,
    private readonly settings: MerchantSettingsService,
  ) {}

  async enqueueWithin(
    manager: EntityManager,
    input: EnqueueMerchantCallback,
  ): Promise<MerchantCallback> {
    const url =
      input.dealCallbackUrl ??
      (await this.settings.callbackUrlWithin(manager, input.merchantId));
    const { eventSeq } = input;
    const eventId = randomUUID();

    return manager.save(
      manager.create(MerchantCallback, {
        merchantId: input.merchantId,
        transactionId: input.transactionId,
        merchantTransactionId: input.merchantTransactionId,
        eventId,
        eventSeq,
        event: input.event,
        payload: {
          eventId,
          eventSeq,
          event: input.event,
          occurredAt: input.occurredAt.toISOString(),
          payment: input.payment,
        },
        url,
        status: url
          ? MerchantCallbackStatus.Pending
          : MerchantCallbackStatus.Skipped,
        nextAttemptAt: url ? input.occurredAt : null,
      }),
    );
  }

  async deliveryStateWithin(
    manager: EntityManager,
    transactionId: string,
    since: Date,
  ): Promise<{ queued: boolean; recent: boolean }> {
    const [queued, recent] = await Promise.all([
      manager.exists(MerchantCallback, {
        where: {
          transactionId,
          status: In([
            MerchantCallbackStatus.Pending,
            MerchantCallbackStatus.Retrying,
          ]),
        },
      }),
      manager.exists(MerchantCallback, {
        where: { transactionId, createdAt: MoreThan(since) },
      }),
    ]);

    return { queued, recent };
  }

  async listOfMerchant(
    merchantId: string,
    query: MerchantCallbackListQuery,
  ): Promise<Page<MerchantCallback>> {
    const scoped: FindOptionsWhere<MerchantCallback> = {
      merchantId,
      ...(query.statuses?.length ? { status: In(query.statuses) } : {}),
      ...(query.createdFrom || query.createdTo
        ? { createdAt: createdRange(query.createdFrom, query.createdTo) }
        : {}),
    };
    const where = query.search
      ? [
          { ...scoped, merchantTransactionId: query.search },
          ...(isUUID(query.search)
            ? [{ ...scoped, transactionId: query.search }]
            : []),
        ]
      : scoped;

    return toPage(
      await this.callbacks.findAndCount({
        where,
        order: { createdAt: query.sortOrder, id: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  listOfDeal(transactionId: string): Promise<MerchantCallback[]> {
    return this.callbacks.find({
      where: { transactionId },
      order: { eventSeq: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  async resend(
    id: string,
    merchantId?: string,
    now: Date = new Date(),
  ): Promise<MerchantCallback> {
    return this.callbacks.manager.transaction(async (manager) => {
      const found = await manager.findOne(MerchantCallback, {
        where: { id, ...(merchantId ? { merchantId } : {}) },
      });

      if (!found) throw new NotFoundException('Callback not found');

      const rootId = found.resendOfId ?? found.id;
      const root = await manager.findOne(MerchantCallback, {
        where: { id: rootId },
        lock: { mode: 'pessimistic_write' },
      });
      const source =
        rootId === found.id
          ? (root as MerchantCallback)
          : await manager.findOneOrFail(MerchantCallback, {
              where: { id: found.id },
            });

      if (!RESENDABLE.includes(source.status)) {
        throw new ConflictException(
          'Only a delivered or a failed callback can be sent again',
        );
      }

      if (
        await manager.exists(MerchantCallback, {
          where: [
            {
              resendOfId: rootId,
              createdAt: MoreThan(new Date(now.getTime() - RESEND_INTERVAL_MS)),
            },
            {
              resendOfId: rootId,
              status: In([
                MerchantCallbackStatus.Pending,
                MerchantCallbackStatus.Retrying,
              ]),
            },
          ],
        })
      ) {
        throw new ConflictException(
          'This callback was sent again less than a minute ago',
        );
      }

      return manager.save(
        manager.create(MerchantCallback, {
          merchantId: source.merchantId,
          transactionId: source.transactionId,
          merchantTransactionId: source.merchantTransactionId,
          eventId: source.eventId,
          eventSeq: source.eventSeq,
          event: source.event,
          payload: source.payload,
          url: source.url,
          status: MerchantCallbackStatus.Pending,
          nextAttemptAt: now,
          resendOfId: rootId,
          isResend: true,
        }),
      );
    });
  }
}

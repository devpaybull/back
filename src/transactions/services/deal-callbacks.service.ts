import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MerchantCallbacksService } from '../../merchant-callbacks/services/merchant-callbacks.service';
import { MerchantCallbackEvent } from '../../merchant-callbacks/types/merchant-callback-event.enum';
import { Transaction } from '../entities/transaction.entity';
import { PaymentViewService } from './payment-view.service';

@Injectable()
export class DealCallbacksService {
  constructor(
    private readonly callbacks: MerchantCallbacksService,
    private readonly payments: PaymentViewService,
  ) {}

  async recordWithin(
    manager: EntityManager,
    deal: Transaction,
    event: MerchantCallbackEvent,
  ): Promise<void> {
    if (!deal.merchantId || !deal.merchantTransactionId) return;

    const [payment] = await this.payments.paymentsOf(manager, [deal]);
    const eventSeq = (deal.callbackSeq ?? 0) + 1;

    deal.callbackSeq = eventSeq;
    await manager.update(Transaction, deal.id, { callbackSeq: eventSeq });

    await this.callbacks.enqueueWithin(manager, {
      merchantId: deal.merchantId,
      transactionId: deal.id,
      merchantTransactionId: deal.merchantTransactionId,
      dealCallbackUrl: deal.callbackUrl ?? null,
      event,
      eventSeq,
      occurredAt: new Date(),
      payment,
    });
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { PaymentPageDto, PaymentPageReceiptDto } from '../dto/payment-page.dto';
import { TransactionFile } from '../entities/transaction-file.entity';
import { Transaction } from '../entities/transaction.entity';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionFileKind } from '../types/transaction-file-kind.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { TransactionUpload } from '../types/transaction-upload';
import { isFinalStatus } from '../utils/status-transitions';
import { PaymentViewService } from './payment-view.service';
import { TransactionFilesService } from './transaction-files.service';
import { TransactionService } from './transaction.service';

const PAYER_RECEIPTS_MAX = 3;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const pageNotFound = (): NotFoundException =>
  new NotFoundException({
    statusCode: 404,
    code: 'PAYMENT_PAGE_NOT_FOUND',
    message: 'Payment page not found',
  });

const receiptLimitReached = (): ConflictException =>
  new ConflictException({
    statusCode: 409,
    code: 'RECEIPT_LIMIT_REACHED',
    message: `At most ${PAYER_RECEIPTS_MAX} receipts can be uploaded for a payment`,
  });

@Injectable()
export class PaymentPageService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly transactions: TransactionService,
    private readonly payments: PaymentViewService,
    private readonly files: TransactionFilesService,
    private readonly settings: MerchantSettingsService,
    private readonly audit: AuditService,
  ) {}

  async view(token: string): Promise<PaymentPageDto> {
    return this.pageOf(
      await this.liveDeal(this.dataSource.manager, token, false),
    );
  }

  async markPaid(
    token: string,
    now: Date = new Date(),
  ): Promise<PaymentPageDto> {
    const deal = await this.dataSource.transaction(async (manager) => {
      const locked = await this.liveDeal(manager, token, true);

      if (locked.payerPaidAt) return locked;

      if (
        locked.status !== TransactionStatus.Active ||
        !locked.expiresAt ||
        locked.expiresAt.getTime() <= now.getTime()
      ) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PAYMENT_NOT_PAYABLE',
          message: 'This payment is no longer waiting for the client',
        });
      }

      locked.payerPaidAt = now;
      const moved = await this.transactions.transitionLocked(manager, locked, {
        toStatus: TransactionStatus.Checking,
        source: StatusEventSource.Payer,
        actorUserId: null,
      });

      await this.audit.record(
        {
          actorUserId: null,
          action: 'payment_page.paid',
          metadata: { merchantId: locked.merchantId, transactionId: locked.id },
        },
        manager,
      );

      return moved;
    });

    return this.pageOf(deal);
  }

  async uploadReceipt(
    token: string,
    upload: TransactionUpload,
  ): Promise<PaymentPageReceiptDto> {
    const current = await this.liveDeal(this.dataSource.manager, token, false);

    if (
      (await this.receiptsOf(this.dataSource.manager, current.id)) >=
      PAYER_RECEIPTS_MAX
    ) {
      throw receiptLimitReached();
    }

    const stored = await this.files.store(current.id, upload);

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const deal = await this.liveDeal(manager, token, true);

        if ((await this.receiptsOf(manager, deal.id)) >= PAYER_RECEIPTS_MAX) {
          throw receiptLimitReached();
        }

        const file = await this.files.recordWithin(
          manager,
          deal.id,
          TransactionFileKind.PayerReceipt,
          stored,
          null,
        );

        await this.audit.record(
          {
            actorUserId: null,
            action: 'payment_page.receipt_uploaded',
            metadata: {
              merchantId: deal.merchantId,
              transactionId: deal.id,
              fileId: file.id,
              fileName: file.name,
            },
          },
          manager,
        );

        return file;
      });

      return { name: saved.name, size: saved.size, mime: saved.mime };
    } catch (error) {
      await this.files.discard(stored);
      throw error;
    }
  }

  private async liveDeal(
    manager: EntityManager,
    token: string,
    lock: boolean,
  ): Promise<Transaction> {
    if (!TOKEN_PATTERN.test(token)) throw pageNotFound();

    const deal = await manager.findOne(Transaction, {
      where: { paymentPageToken: token, kind: TransactionKind.PayIn },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });

    if (!deal || isFinalStatus(deal.status)) throw pageNotFound();

    return deal;
  }

  private receiptsOf(
    manager: EntityManager,
    transactionId: string,
  ): Promise<number> {
    return manager.count(TransactionFile, {
      where: { transactionId, kind: TransactionFileKind.PayerReceipt },
    });
  }

  private async pageOf(deal: Transaction): Promise<PaymentPageDto> {
    const [[payment], settings] = await Promise.all([
      this.payments.paymentsOf(this.dataSource.manager, [deal]),
      deal.merchantId ? this.settings.settingsOf(deal.merchantId) : null,
    ]);

    return {
      amount: payment.amount,
      currency: payment.currency,
      requisite: payment.requisite,
      expiresAt: payment.expiresAt,
      status: payment.status,
      successUrl: deal.successUrl ?? settings?.successUrl ?? null,
      errorUrl: deal.errorUrl ?? settings?.errorUrl ?? null,
      supportLink: settings?.supportLink ?? null,
    };
  }
}

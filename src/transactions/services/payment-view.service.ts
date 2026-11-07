import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, In } from 'typeorm';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { BanksService } from '../../banks/banks.service';
import { Bank } from '../../banks/entities/bank.entity';
import { PaymentDto, toPaymentDto } from '../dto/payment.dto';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionFile } from '../entities/transaction-file.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionFileKind } from '../types/transaction-file-kind.enum';

const distinct = <T>(values: (T | null | undefined)[]): T[] => [
  ...new Set(
    values.filter((value): value is T => value !== null && value !== undefined),
  ),
];

@Injectable()
export class PaymentViewService {
  constructor(
    private readonly bankDetails: BankDetailsService,
    private readonly banks: BanksService,
    private readonly config: ConfigService,
  ) {}

  private paymentPageUrlOf(deal: Transaction): string | null {
    const base = this.config.get<string>('PAYMENT_PAGE_URL', '');

    return base && deal.paymentPageToken
      ? `${base.replace(/\/+$/, '')}/${deal.paymentPageToken}`
      : null;
  }

  async paymentsOf(
    manager: EntityManager,
    deals: Transaction[],
    requestedBank?: Bank | null,
  ): Promise<PaymentDto[]> {
    const requisiteIds = distinct(deals.map((deal) => deal.bankDetailsId));
    const bankIds = distinct(
      deals.flatMap((deal) => [
        requestedBank === undefined ? deal.requestedBankId : null,
        deal.payoutBankId,
      ]),
    );
    const dealIds = deals.map((deal) => deal.id);
    const requisites = requisiteIds.length
      ? await this.bankDetails.findByIdsWithDeleted(requisiteIds, manager)
      : [];
    const banks = bankIds.length
      ? await this.banks.findByIds(bankIds, manager)
      : [];
    const disputes = dealIds.length
      ? await manager.find(TransactionDispute, {
          where: { transactionId: In(dealIds) },
          order: { id: 'ASC' },
        })
      : [];
    const files = dealIds.length
      ? await manager.find(TransactionFile, {
          where: {
            transactionId: In(dealIds),
            kind: TransactionFileKind.DisputeReceipt,
          },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
      : [];
    const requisiteById = new Map(requisites.map((row) => [row.id, row]));
    const bankById = new Map(banks.map((bank) => [bank.id, bank]));
    const latestDispute = new Map(
      disputes.map((dispute) => [dispute.transactionId, dispute]),
    );
    const bankOf = (id: number | null | undefined): Bank | null =>
      (id && bankById.get(id)) || null;

    return deals.map((deal) =>
      toPaymentDto(deal, {
        requisite: requisiteById.get(deal.bankDetailsId) ?? null,
        requestedBank:
          requestedBank === undefined
            ? bankOf(deal.requestedBankId)
            : requestedBank,
        payoutBank: bankOf(deal.payoutBankId),
        paymentPageUrl: this.paymentPageUrlOf(deal),
        dispute: latestDispute.get(deal.id) ?? null,
        disputeFiles: files,
      }),
    );
  }
}

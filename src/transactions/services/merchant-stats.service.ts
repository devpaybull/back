import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toCrypto } from '../../common/utils/to-crypto';
import { Transaction } from '../entities/transaction.entity';
import { MerchantPayInStats } from '../types/merchant-pay-in-stats';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const SUCCESSFUL = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];

@Injectable()
export class MerchantStatsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
  ) {}

  async payInStats(
    merchantId: string,
    from: Date,
    to: Date,
  ): Promise<MerchantPayInStats> {
    const row = await this.transactions
      .createQueryBuilder('transaction')
      .select(
        'COUNT(*) FILTER (WHERE transaction.createdAt >= :from AND transaction.createdAt < :to)',
        'total',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE transaction.createdAt >= :from AND transaction.createdAt < :to AND transaction.status IN (:...statuses))',
        'successful',
      )
      .addSelect(
        'COALESCE(SUM(transaction.amountCrypto) FILTER (WHERE transaction.resolvedAt >= :from AND transaction.resolvedAt < :to AND transaction.status IN (:...statuses)), 0)',
        'turnover',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE transaction.resolvedAt >= :from AND transaction.resolvedAt < :to AND transaction.status IN (:...statuses))',
        'turnoverCount',
      )
      .where('transaction.merchantId = :merchantId', { merchantId })
      .andWhere('transaction.kind = :kind', { kind: TransactionKind.PayIn })
      .setParameters({ from, to, statuses: SUCCESSFUL })
      .getRawOne<{
        total: string;
        successful: string;
        turnover: string;
        turnoverCount: string;
      }>();

    return {
      total: Number(row?.total ?? 0),
      successful: Number(row?.successful ?? 0),
      turnover: toCrypto(row?.turnover ?? 0),
      turnoverCount: Number(row?.turnoverCount ?? 0),
    };
  }
}

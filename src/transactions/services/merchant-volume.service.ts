import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toFiat } from '../../common/utils/to-fiat';
import { Transaction } from '../entities/transaction.entity';
import { MerchantMethodVolume } from '../types/merchant-method-volume';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const SUCCESSFUL = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];

@Injectable()
export class MerchantVolumeService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
  ) {}

  async volumesByMerchant(
    merchantIds: string[],
    from: Date,
    to: Date,
  ): Promise<MerchantMethodVolume[]> {
    if (merchantIds.length === 0) return [];

    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select('transaction.merchantId', 'merchantId')
      .addSelect('transaction.method', 'method')
      .addSelect('transaction.kind', 'kind')
      .addSelect('SUM(transaction.amountFiat)', 'volume')
      .where('transaction.merchantId IN (:...merchantIds)', { merchantIds })
      .andWhere('transaction.status IN (:...statuses)', {
        statuses: SUCCESSFUL,
      })
      .andWhere('transaction.resolvedAt >= :from', { from })
      .andWhere('transaction.resolvedAt < :to', { to })
      .groupBy('transaction.merchantId')
      .addGroupBy('transaction.method')
      .addGroupBy('transaction.kind')
      .getRawMany<{
        merchantId: string;
        method: string;
        kind: TransactionKind;
        volume: string;
      }>();

    return rows.map((row) => ({
      merchantId: row.merchantId,
      method: row.method,
      kind: row.kind,
      volume: toFiat(row.volume),
    }));
  }
}

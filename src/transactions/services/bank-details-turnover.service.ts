import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toFiat } from '../../common/utils/to-fiat';
import { Transaction } from '../entities/transaction.entity';
import { BankDetailsTurnover } from '../types/bank-details-turnover';
import { TransactionStatus } from '../types/transaction-status.enum';
import { startOfDayIn } from '../utils/start-of-day-in';
import { startOfMonthIn } from '../utils/start-of-month-in';

const SUCCESSFUL = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];

@Injectable()
export class BankDetailsTurnoverService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    private readonly config: ConfigService,
  ) {}

  async turnoverOfBankDetails(
    ids: string[],
    now: Date,
  ): Promise<Map<string, BankDetailsTurnover>> {
    const turnover = new Map<string, BankDetailsTurnover>(
      ids.map((id) => [
        id,
        { total: toFiat(0), today: toFiat(0), month: toFiat(0) },
      ]),
    );

    if (ids.length === 0) return turnover;

    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select('transaction.bankDetailsId', 'bankDetailsId')
      .addSelect('COALESCE(SUM(transaction.amountFiat), 0)', 'total')
      .addSelect(
        'COALESCE(SUM(CASE WHEN transaction.resolvedAt >= :dayStart THEN transaction.amountFiat ELSE 0 END), 0)',
        'today',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN transaction.resolvedAt >= :monthStart THEN transaction.amountFiat ELSE 0 END), 0)',
        'month',
      )
      .where('transaction.bankDetailsId IN (:...ids)', { ids })
      .andWhere('transaction.status IN (:...statuses)', {
        statuses: SUCCESSFUL,
      })
      .setParameters({
        dayStart: startOfDayIn(now, timeZone),
        monthStart: startOfMonthIn(now, timeZone),
      })
      .groupBy('transaction.bankDetailsId')
      .getRawMany<{
        bankDetailsId: string;
        total: string;
        today: string;
        month: string;
      }>();

    rows.forEach((row) =>
      turnover.set(row.bankDetailsId, {
        total: toFiat(row.total),
        today: toFiat(row.today),
        month: toFiat(row.month),
      }),
    );

    return turnover;
  }

  async pageOfBankDetailsByTurnover(
    ids: string[],
    direction: 'ASC' | 'DESC',
    offset: number,
    limit: number,
  ): Promise<string[]> {
    if (ids.length === 0) return [];

    const rows: { id: string }[] = await this.transactions.query(
      `SELECT candidate.id AS id
         FROM unnest($1::uuid[]) AS candidate(id)
         LEFT JOIN (
           SELECT "bankDetailsId", SUM("amountFiat") AS total
             FROM transactions
            WHERE "bankDetailsId" = ANY($1::uuid[])
              AND status::text = ANY($2::text[])
            GROUP BY "bankDetailsId"
         ) turnover ON turnover."bankDetailsId" = candidate.id
        ORDER BY COALESCE(turnover.total, 0) ${direction}, candidate.id ${direction}
        LIMIT $3 OFFSET $4`,
      [ids, SUCCESSFUL, limit, offset],
    );

    return rows.map((row) => row.id);
  }
}

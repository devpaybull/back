import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Fiat } from '../../common/types/fiat';
import { formatFiat } from '../../common/utils/format-fiat';
import { toFiat } from '../../common/utils/to-fiat';
import { Transaction } from '../entities/transaction.entity';
import { BankDetailsTurnover } from '../types/bank-details-turnover';
import { BankDetailsUsage } from '../types/bank-details-usage';
import { RequisiteIssueUsage } from '../types/requisite-issue-usage';
import { TransactionStatus } from '../types/transaction-status.enum';
import { startOfDayIn } from '../utils/start-of-day-in';
import { startOfMonthIn } from '../utils/start-of-month-in';

const SUCCESSFUL = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
];

const FINAL = [...SUCCESSFUL, TransactionStatus.Canceled];

const HOUR_MS = 60 * 60 * 1000;

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

  async usageOfBankDetails(
    ids: string[],
    now: Date,
  ): Promise<Map<string, BankDetailsUsage>> {
    const usage = new Map<string, BankDetailsUsage>(
      ids.map((id) => [id, { dealsToday: 0, lastHourAmount: toFiat(0) }]),
    );

    if (ids.length === 0) return usage;

    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select('transaction.bankDetailsId', 'bankDetailsId')
      .addSelect(
        'COUNT(*) FILTER (WHERE transaction.createdAt >= :dayStart)',
        'dealsToday',
      )
      .addSelect(
        'COALESCE(SUM(transaction.amountFiat) FILTER (WHERE transaction.createdAt >= :hourStart), 0)',
        'lastHourAmount',
      )
      .where('transaction.bankDetailsId IN (:...ids)', { ids })
      .andWhere('transaction.status != :canceled', {
        canceled: TransactionStatus.Canceled,
      })
      .andWhere(
        'transaction.createdAt >= LEAST(CAST(:dayStart AS timestamptz), CAST(:hourStart AS timestamptz))',
      )
      .setParameters({
        dayStart: startOfDayIn(now, timeZone),
        hourStart: new Date(now.getTime() - HOUR_MS),
      })
      .groupBy('transaction.bankDetailsId')
      .getRawMany<{
        bankDetailsId: string;
        dealsToday: string;
        lastHourAmount: string;
      }>();

    rows.forEach((row) =>
      usage.set(row.bankDetailsId, {
        dealsToday: Number(row.dealsToday),
        lastHourAmount: toFiat(row.lastHourAmount),
      }),
    );

    return usage;
  }

  async issueUsageOf(
    ids: readonly string[],
    amountFiat: Fiat,
    now: Date,
    manager?: EntityManager,
  ): Promise<Map<string, RequisiteIssueUsage>> {
    const usage = new Map<string, RequisiteIssueUsage>(
      ids.map((id) => [
        id,
        {
          dealsToday: 0,
          dealsMonth: 0,
          amountToday: toFiat(0),
          amountMonth: toFiat(0),
          amountLastHour: toFiat(0),
          openDeals: 0,
          openWithSameAmount: false,
          lastDealAt: null,
        },
      ]),
    );

    if (ids.length === 0) return usage;

    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
    const repository = manager
      ? manager.getRepository(Transaction)
      : this.transactions;
    const counted = 'transaction.status != :canceled';
    const open = 'transaction.status NOT IN (:...final)';
    const rows = await repository
      .createQueryBuilder('transaction')
      .select('transaction.bankDetailsId', 'bankDetailsId')
      .addSelect(
        `COUNT(*) FILTER (WHERE ${counted} AND transaction.createdAt >= :dayStart)`,
        'dealsToday',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE ${counted} AND transaction.createdAt >= :monthStart)`,
        'dealsMonth',
      )
      .addSelect(
        `COALESCE(SUM(transaction.amountFiat) FILTER (WHERE ${counted} AND transaction.createdAt >= :dayStart), 0)`,
        'amountToday',
      )
      .addSelect(
        `COALESCE(SUM(transaction.amountFiat) FILTER (WHERE ${counted} AND transaction.createdAt >= :monthStart), 0)`,
        'amountMonth',
      )
      .addSelect(
        `COALESCE(SUM(transaction.amountFiat) FILTER (WHERE ${counted} AND transaction.createdAt >= :hourStart), 0)`,
        'amountLastHour',
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${open})`, 'openDeals')
      .addSelect(
        `COUNT(*) FILTER (WHERE ${open} AND transaction.amountFiat = CAST(:amount AS numeric))`,
        'openWithSameAmount',
      )
      .addSelect('MAX(transaction.createdAt)', 'lastDealAt')
      .where('transaction.bankDetailsId IN (:...ids)', { ids: [...ids] })
      .setParameters({
        canceled: TransactionStatus.Canceled,
        final: FINAL,
        amount: formatFiat(amountFiat),
        dayStart: startOfDayIn(now, timeZone),
        monthStart: startOfMonthIn(now, timeZone),
        hourStart: new Date(now.getTime() - HOUR_MS),
      })
      .groupBy('transaction.bankDetailsId')
      .getRawMany<{
        bankDetailsId: string;
        dealsToday: string;
        dealsMonth: string;
        amountToday: string;
        amountMonth: string;
        amountLastHour: string;
        openDeals: string;
        openWithSameAmount: string;
        lastDealAt: Date | string | null;
      }>();

    rows.forEach((row) =>
      usage.set(row.bankDetailsId, {
        dealsToday: Number(row.dealsToday),
        dealsMonth: Number(row.dealsMonth),
        amountToday: toFiat(row.amountToday),
        amountMonth: toFiat(row.amountMonth),
        amountLastHour: toFiat(row.amountLastHour),
        openDeals: Number(row.openDeals),
        openWithSameAmount: Number(row.openWithSameAmount) > 0,
        lastDealAt: row.lastDealAt ? new Date(row.lastDealAt) : null,
      }),
    );

    return usage;
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

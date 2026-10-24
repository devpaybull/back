import { Injectable } from '@nestjs/common';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionService } from '../transactions/services/transaction.service';
import { TransactionKind } from '../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../transactions/types/transaction-status.enum';
import { roundMoney } from '../transactions/utils/round-money';
import {
  DealsAnalyticsDto,
  PayInAnalyticsDto,
  VolumeAnalyticsDto,
} from './dto/analytics.dto';

const WINDOW_DAYS = 14;

const isSuccess = (row: Transaction): boolean =>
  row.status === TransactionStatus.Success ||
  row.status === TransactionStatus.SuccessChanged;
const isFail = (row: Transaction): boolean =>
  row.status === TransactionStatus.Canceled;
const isDispute = (row: Transaction): boolean =>
  row.status === TransactionStatus.Dispute;
const isPayIn = (row: Transaction): boolean =>
  row.kind === TransactionKind.PayIn;
const isPayOut = (row: Transaction): boolean =>
  row.kind === TransactionKind.PayOut;

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

const percent = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2));

const sumOf = (
  rows: Transaction[],
  select: (row: Transaction) => number,
): number =>
  roundMoney(rows.reduce((total, row) => total + (select(row) ?? 0), 0));

@Injectable()
export class AnalyticsService {
  constructor(private readonly transactions: TransactionService) {}

  async payIn(userId: string): Promise<PayInAnalyticsDto> {
    const rows = (await this.window(userId)).filter(isPayIn);

    const series = this.dayKeys().map((date) => {
      const day = rows.filter((row) => dayKey(row.createdAt) === date);
      const success = day.filter(isSuccess).length;
      const fail = day.filter(isFail).length;
      return {
        date,
        conversionPercent: percent(success, success + fail),
        disputePercent: percent(day.filter(isDispute).length, day.length),
      };
    });

    const success = rows.filter(isSuccess).length;
    const fail = rows.filter(isFail).length;

    return {
      averageConversionPercent: percent(success, success + fail),
      disputePercent: percent(rows.filter(isDispute).length, rows.length),
      series,
    };
  }

  async deals(userId: string): Promise<DealsAnalyticsDto> {
    const rows = await this.window(userId);

    const series = this.dayKeys().map((date) => {
      const day = rows.filter((row) => dayKey(row.createdAt) === date);
      return {
        date,
        total: day.length,
        success: day.filter(isSuccess).length,
        fail: day.filter(isFail).length,
        dispute: day.filter(isDispute).length,
      };
    });

    return {
      total: rows.length,
      success: rows.filter(isSuccess).length,
      fail: rows.filter(isFail).length,
      dispute: rows.filter(isDispute).length,
      series,
    };
  }

  async volume(userId: string): Promise<VolumeAnalyticsDto> {
    const rows = await this.window(userId);

    const series = this.dayKeys().map((date) => {
      const day = rows.filter((row) => dayKey(row.createdAt) === date);
      return {
        date,
        payInCount: day.filter(isPayIn).length,
        payOutCount: day.filter(isPayOut).length,
      };
    });

    const successfulPayIn = rows.filter(
      (row) => isSuccess(row) && isPayIn(row),
    );
    const successfulPayOut = rows.filter(
      (row) => isSuccess(row) && isPayOut(row),
    );

    return {
      payInCount: rows.filter(isPayIn).length,
      payOutCount: rows.filter(isPayOut).length,
      series,
      summary: {
        cryptoSent: sumOf(successfulPayIn, (row) => row.traderAmount),
        cryptoReceived: sumOf(successfulPayOut, (row) => row.traderAmount),
        fiatReceived: sumOf(successfulPayIn, (row) => row.amountFiat),
        fiatSent: sumOf(successfulPayOut, (row) => row.amountFiat),
        profit: sumOf(rows.filter(isSuccess), (row) => row.traderCommission),
      },
    };
  }

  private window(userId: string): Promise<Transaction[]> {
    return this.transactions.findTraderWindow(userId, this.windowStart());
  }

  private windowStart(): Date {
    const now = new Date();
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (WINDOW_DAYS - 1),
      ),
    );
  }

  private dayKeys(): string[] {
    const start = this.windowStart();
    const keys: string[] = [];
    for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + offset);
      keys.push(dayKey(day));
    }
    return keys;
  }
}

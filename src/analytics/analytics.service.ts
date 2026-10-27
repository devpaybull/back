import Decimal from 'decimal.js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { addCalendarDays } from '../common/utils/add-calendar-days';
import { calendarDateIn } from '../common/utils/calendar-date-in';
import { formatCrypto } from '../common/utils/format-crypto';
import { formatFiat } from '../common/utils/format-fiat';
import { toDecimal } from '../common/utils/to-decimal';
import { zonedMidnight } from '../common/utils/zoned-midnight';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransactionService } from '../transactions/services/transaction.service';
import { TransactionKind } from '../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../transactions/types/transaction-status.enum';
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

const percent = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2));

const sumOf = (
  rows: Transaction[],
  select: (row: Transaction) => Decimal | null,
): Decimal =>
  rows.reduce((total, row) => total.plus(select(row) ?? 0), toDecimal(0));

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly config: ConfigService,
  ) {}

  async payIn(userId: string): Promise<PayInAnalyticsDto> {
    const rows = (await this.window(userId)).filter(isPayIn);

    const series = this.dayKeys().map((date) => {
      const day = rows.filter((row) => this.dayOf(row) === date);
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
      const day = rows.filter((row) => this.dayOf(row) === date);
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
      const day = rows.filter((row) => this.dayOf(row) === date);
      const successful = day.filter(isSuccess);
      return {
        date,
        payInCount: day.filter(isPayIn).length,
        payOutCount: day.filter(isPayOut).length,
        payInAmount: formatCrypto(
          sumOf(successful.filter(isPayIn), (row) => row.amountCrypto),
        ),
        payOutAmount: formatCrypto(
          sumOf(successful.filter(isPayOut), (row) => row.amountCrypto),
        ),
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
        cryptoSent: formatCrypto(
          sumOf(successfulPayIn, (row) => row.amountCrypto),
        ),
        cryptoReceived: formatCrypto(
          sumOf(successfulPayOut, (row) => row.amountCrypto),
        ),
        fiatReceived: formatFiat(
          sumOf(successfulPayIn, (row) => row.amountFiat),
        ),
        fiatSent: formatFiat(sumOf(successfulPayOut, (row) => row.amountFiat)),
        profit: formatCrypto(
          sumOf(rows.filter(isSuccess), (row) => row.traderCommission),
        ),
      },
    };
  }

  private window(userId: string): Promise<Transaction[]> {
    return this.transactions.findTraderWindow(
      userId,
      zonedMidnight(this.dayKeys()[0], this.timeZone()),
    );
  }

  private dayOf(row: Transaction): string {
    return calendarDateIn(row.createdAt, this.timeZone());
  }

  private dayKeys(): string[] {
    const today = calendarDateIn(new Date(), this.timeZone());

    return Array.from({ length: WINDOW_DAYS }, (_, index) =>
      addCalendarDays(today, index - (WINDOW_DAYS - 1)),
    );
  }

  private timeZone(): string {
    return this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
  }
}

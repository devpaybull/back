import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { Transaction } from '../entities/transaction.entity';
import { TransactionStatus } from '../types/transaction-status.enum';
import { isNightWindow } from '../utils/is-night-window';

@Injectable()
export class NightStopService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    private readonly traderSettings: TraderSettingsService,
    private readonly config: ConfigService,
  ) {}

  isWithinNightStopWindow(now: Date): boolean {
    return isNightWindow(
      now,
      this.config.getOrThrow<number>('NIGHT_STOP_START_HOUR'),
      this.config.getOrThrow<number>('NIGHT_STOP_END_HOUR'),
      this.config.getOrThrow<string>('NIGHT_STOP_TIMEZONE'),
    );
  }

  async isOnNightStop(traderUserId: string, now: Date): Promise<boolean> {
    return (await this.nightStoppedAmong([traderUserId], now)).has(
      traderUserId,
    );
  }

  async nightStoppedAmong(
    traderUserIds: string[],
    now: Date,
  ): Promise<Set<string>> {
    if (traderUserIds.length === 0 || !this.isWithinNightStopWindow(now)) {
      return new Set();
    }

    const settingsByUser = new Map(
      (await this.traderSettings.findByUserIds(traderUserIds)).map((row) => [
        row.userId,
        row,
      ]),
    );
    const disputes = await this.countOpenDisputesByTrader(traderUserIds);

    return new Set(
      traderUserIds.filter((userId) => {
        const settings = settingsByUser.get(userId);
        if (settings && !settings.nightStopEnabled) return false;

        return (
          (disputes.get(userId) ?? 0) >=
          this.traderSettings.nightStopThresholdOf(settings)
        );
      }),
    );
  }

  private async countOpenDisputesByTrader(
    traderUserIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.transactions
      .createQueryBuilder('transaction')
      .select('transaction.traderUserId', 'traderUserId')
      .addSelect('COUNT(*)', 'disputes')
      .where('transaction.traderUserId IN (:...traderUserIds)', {
        traderUserIds,
      })
      .andWhere('transaction.status = :status', {
        status: TransactionStatus.Dispute,
      })
      .groupBy('transaction.traderUserId')
      .getRawMany<{ traderUserId: string; disputes: string }>();

    return new Map(rows.map((row) => [row.traderUserId, Number(row.disputes)]));
  }
}

import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { NightStopService } from '../services/night-stop.service';
import { TransactionStatus } from '../types/transaction-status.enum';

describe('NightStopService', () => {
  const GLOBAL_THRESHOLD = 2;
  const inWindow = new Date('2026-03-10T22:00:00Z');
  const atWindowEnd = new Date('2026-03-11T07:00:00Z');
  const lastMinuteInside = new Date('2026-03-11T06:59:00Z');
  const atWindowStart = new Date('2026-03-10T21:00:00Z');
  const justBeforeStart = new Date('2026-03-10T20:59:00Z');
  const midday = new Date('2026-03-10T09:00:00Z');

  const settingsRow = (
    overrides: Partial<TraderSettings> = {},
  ): TraderSettings =>
    ({
      userId: uuidOf(1),
      nightStopEnabled: true,
      nightStopThreshold: null,
      ...overrides,
    }) as TraderSettings;

  const build = (
    disputes: number,
    row: TraderSettings | null,
    env: Record<string, unknown> = {},
  ) => {
    const values: Record<string, unknown> = {
      NIGHT_STOP_THRESHOLD: GLOBAL_THRESHOLD,
      NIGHT_STOP_START_HOUR: 0,
      NIGHT_STOP_END_HOUR: 10,
      NIGHT_STOP_TIMEZONE: 'Europe/Moscow',
      INSURANCE_NIGHT_START_HOUR: 5,
      INSURANCE_NIGHT_END_HOUR: 6,
      INSURANCE_NIGHT_TIMEZONE: 'UTC',
      ...env,
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => values[key]),
    };
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () =>
        disputes > 0
          ? [{ traderUserId: uuidOf(1), disputes: String(disputes) }]
          : [],
      ),
    };
    const transactions = { createQueryBuilder: jest.fn(() => builder) };
    const settingsRepository = {
      find: jest.fn(async () => (row ? [row] : [])),
    };
    const traderSettings = new TraderSettingsService(
      settingsRepository as never,
      {} as never,
      {} as never,
      config as never,
    );

    return {
      service: new NightStopService(
        transactions as never,
        traderSettings,
        config as never,
      ),
      transactions,
      builder,
      settingsRepository,
    };
  };

  describe('the window', () => {
    it('includes its first hour and excludes its end', () => {
      const { service } = build(0, null);

      expect(service.isWithinNightStopWindow(atWindowStart)).toBe(true);
      expect(service.isWithinNightStopWindow(lastMinuteInside)).toBe(true);
      expect(service.isWithinNightStopWindow(atWindowEnd)).toBe(false);
      expect(service.isWithinNightStopWindow(justBeforeStart)).toBe(false);
      expect(service.isWithinNightStopWindow(midday)).toBe(false);
    });

    it('is its own, not the insurance night window', () => {
      const { service } = build(0, null);

      expect(service.isWithinNightStopWindow(inWindow)).toBe(true);
    });

    it('follows the configured hours and timezone', () => {
      const { service } = build(0, null, {
        NIGHT_STOP_START_HOUR: 9,
        NIGHT_STOP_END_HOUR: 10,
        NIGHT_STOP_TIMEZONE: 'UTC',
      });

      expect(service.isWithinNightStopWindow(midday)).toBe(true);
      expect(service.isWithinNightStopWindow(inWindow)).toBe(false);
    });
  });

  describe('isOnNightStop', () => {
    it('stops a trader whose open disputes equal the threshold', async () => {
      const { service } = build(2, settingsRow());

      await expect(service.isOnNightStop(uuidOf(1), inWindow)).resolves.toBe(
        true,
      );
    });

    it('stops a trader above the threshold', async () => {
      const { service } = build(5, settingsRow());

      await expect(service.isOnNightStop(uuidOf(1), inWindow)).resolves.toBe(
        true,
      );
    });

    it('leaves a trader below the threshold working', async () => {
      const { service } = build(1, settingsRow());

      await expect(service.isOnNightStop(uuidOf(1), inWindow)).resolves.toBe(
        false,
      );
    });

    it('lifts the stop outside the window whatever the disputes', async () => {
      const { service } = build(9, settingsRow());

      await expect(service.isOnNightStop(uuidOf(1), midday)).resolves.toBe(
        false,
      );
      await expect(service.isOnNightStop(uuidOf(1), atWindowEnd)).resolves.toBe(
        false,
      );
    });

    it('never stops a trader who has it disabled', async () => {
      const { service } = build(9, settingsRow({ nightStopEnabled: false }));

      await expect(service.isOnNightStop(uuidOf(1), inWindow)).resolves.toBe(
        false,
      );
    });

    it('uses the personal threshold over the global one', async () => {
      const { service } = build(3, settingsRow({ nightStopThreshold: 4 }));

      await expect(service.isOnNightStop(uuidOf(1), inWindow)).resolves.toBe(
        false,
      );
    });

    it('stops at a personal threshold of 1', async () => {
      const { service } = build(1, settingsRow({ nightStopThreshold: 1 }));

      await expect(service.isOnNightStop(uuidOf(1), inWindow)).resolves.toBe(
        true,
      );
    });

    it('falls back to the global threshold when the personal one is null', async () => {
      const { service } = build(2, settingsRow({ nightStopThreshold: null }));

      await expect(service.isOnNightStop(uuidOf(1), inWindow)).resolves.toBe(
        true,
      );
    });

    it('applies the global defaults to a trader with no settings row', async () => {
      const stopped = build(2, null);
      const working = build(1, null);

      await expect(
        stopped.service.isOnNightStop(uuidOf(1), inWindow),
      ).resolves.toBe(true);
      await expect(
        working.service.isOnNightStop(uuidOf(1), inWindow),
      ).resolves.toBe(false);
    });

    it('counts only the trader’s transactions in dispute, grouped by trader', async () => {
      const { service, builder } = build(2, settingsRow());

      await service.isOnNightStop(uuidOf(1), inWindow);

      expect(builder.andWhere).toHaveBeenCalledWith(
        'transaction.status = :status',
        { status: TransactionStatus.Dispute },
      );
      expect(builder.where).toHaveBeenCalledWith(
        'transaction.traderUserId IN (:...traderUserIds)',
        { traderUserIds: [uuidOf(1)] },
      );
      expect(builder.groupBy).toHaveBeenCalledWith('transaction.traderUserId');
    });

    it('does not count disputes outside the window', async () => {
      const { service, transactions } = build(2, settingsRow());

      await service.isOnNightStop(uuidOf(1), midday);

      expect(transactions.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('nightStoppedAmong', () => {
    it('stops a trader with no settings row once disputes reach the global threshold', async () => {
      const { service } = build(2, null);

      await expect(
        service.nightStoppedAmong([uuidOf(1)], inWindow),
      ).resolves.toEqual(new Set([uuidOf(1)]));
    });

    it('returns an empty set and queries nothing outside the window', async () => {
      const { service, transactions, settingsRepository } = build(9, null);

      await expect(
        service.nightStoppedAmong([uuidOf(1)], midday),
      ).resolves.toEqual(new Set());
      expect(transactions.createQueryBuilder).not.toHaveBeenCalled();
      expect(settingsRepository.find).not.toHaveBeenCalled();
    });

    it('returns an empty set and queries nothing for an empty list', async () => {
      const { service, transactions, settingsRepository } = build(9, null);

      await expect(service.nightStoppedAmong([], inWindow)).resolves.toEqual(
        new Set(),
      );
      expect(transactions.createQueryBuilder).not.toHaveBeenCalled();
      expect(settingsRepository.find).not.toHaveBeenCalled();
    });

    it('answers for many traders with one settings query and one count query', async () => {
      const { service, transactions, settingsRepository, builder } = build(
        3,
        null,
      );

      const stopped = await service.nightStoppedAmong(
        [uuidOf(1), uuidOf(2)],
        inWindow,
      );

      expect(stopped).toEqual(new Set([uuidOf(1)]));
      expect(settingsRepository.find).toHaveBeenCalledTimes(1);
      expect(transactions.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(builder.getRawMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('a window that spans midnight', () => {
    it('stops inside the wrapped hours', async () => {
      const { service } = build(2, null, {
        NIGHT_STOP_START_HOUR: 22,
        NIGHT_STOP_END_HOUR: 6,
        NIGHT_STOP_TIMEZONE: 'UTC',
      });

      expect(
        await service.isOnNightStop(
          uuidOf(1),
          new Date('2026-03-10T23:00:00Z'),
        ),
      ).toBe(true);
      expect(
        await service.isOnNightStop(
          uuidOf(1),
          new Date('2026-03-10T12:00:00Z'),
        ),
      ).toBe(false);
    });
  });
});

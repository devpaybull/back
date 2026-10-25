import { getMetadataArgsStorage } from 'typeorm';
import { ActivityAction } from '../../audit/types/activity-action.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderSettings } from '../entities/trader-settings.entity';
import { TraderSettingsService } from '../trader-settings.service';

describe('TraderSettingsService', () => {
  const base = (overrides: Partial<TraderSettings> = {}): TraderSettings =>
    ({
      id: 1,
      userId: uuidOf(1),
      tradingEnabled: false,
      payoutTradingEnabled: false,
      individualRatesEnabled: false,
      autoBuybackEnabled: false,
      autoBuybackConcurrent: null,
      payInAntifraudEnabled: false,
      qrBuybackAccess: false,
      userTransferAccess: false,
      trustedUser: false,
      insurancePayInMin: null,
      insurancePayOutMin: null,
      nightStopEnabled: true,
      nightStopThreshold: null,
      ...overrides,
    }) as TraderSettings;

  let current: TraderSettings;
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let inserted: { values: jest.Mock; orIgnore: jest.Mock; execute: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let audit: { record: jest.Mock };
  let repository: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: TraderSettingsService;
  const GLOBAL_MIN = 500;
  const GLOBAL_PAY_OUT_MIN = 300;
  const GLOBAL_NIGHT_THRESHOLD = 2;

  const build = (seed: TraderSettings) => {
    current = seed;
    inserted = {
      values: jest.fn(() => inserted),
      orIgnore: jest.fn(() => inserted),
      execute: jest.fn(async () => ({})),
    };
    manager = {
      findOne: jest.fn(async () => current),
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (row) => row),
      createQueryBuilder: jest.fn(() => ({
        insert: () => ({ into: () => inserted }),
      })),
    };
    dataSource = { transaction: jest.fn(async (cb) => cb(manager)) };
    audit = { record: jest.fn() };
    repository = {
      find: jest.fn(async () => []),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => row),
    };
    service = new TraderSettingsService(
      repository as never,
      dataSource as never,
      audit as never,
      {
        get: jest.fn(() => GLOBAL_MIN),
        getOrThrow: jest.fn((key: string) =>
          key === 'NIGHT_STOP_THRESHOLD'
            ? GLOBAL_NIGHT_THRESHOLD
            : GLOBAL_PAY_OUT_MIN,
        ),
      } as never,
    );
  };

  it('applies a plain flag and audits it as a generic update', async () => {
    build(base());

    const result = await service.update(
      uuidOf(1),
      { tradingEnabled: true },
      { actorUserId: uuidOf(9) },
    );

    expect(result.tradingEnabled).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'trader_settings.updated' }),
      manager,
    );
  });

  describe('the activity feed', () => {
    const activityCalls = () =>
      audit.record.mock.calls.filter(([entry]) =>
        String(entry.action).startsWith('activity.'),
      );

    it('records trading switched on, by the admin, against the account, in the same transaction', async () => {
      build(base());

      await service.update(
        uuidOf(1),
        { tradingEnabled: true },
        { actorUserId: uuidOf(9) },
      );

      expect(activityCalls()).toEqual([
        [
          {
            actorUserId: uuidOf(9),
            targetUserId: uuidOf(1),
            action: ActivityAction.TradingEnabled,
          },
          manager,
        ],
      ]);
    });

    it('records trading switched off', async () => {
      build(base({ tradingEnabled: true }));

      await service.update(
        uuidOf(1),
        { tradingEnabled: false },
        { actorUserId: uuidOf(9) },
      );

      expect(activityCalls().map(([entry]) => entry.action)).toEqual([
        ActivityAction.TradingDisabled,
      ]);
    });

    it('records auto-buyback on and off', async () => {
      build(base());
      await service.update(
        uuidOf(1),
        { autoBuybackEnabled: true, autoBuybackConcurrent: 2 },
        { actorUserId: uuidOf(9) },
      );

      expect(activityCalls().map(([entry]) => entry.action)).toEqual([
        ActivityAction.AutoBuybackEnabled,
      ]);

      build(base({ autoBuybackEnabled: true, autoBuybackConcurrent: 2 }));
      await service.update(
        uuidOf(1),
        { autoBuybackEnabled: false },
        { actorUserId: uuidOf(9) },
      );

      expect(activityCalls().map(([entry]) => entry.action)).toEqual([
        ActivityAction.AutoBuybackDisabled,
      ]);
    });

    it('writes one row per flag that changed, next to the generic one', async () => {
      build(base());

      await service.update(
        uuidOf(1),
        { tradingEnabled: true, autoBuybackEnabled: true },
        { actorUserId: uuidOf(9) },
      );

      expect(activityCalls().map(([entry]) => entry.action)).toEqual([
        ActivityAction.TradingEnabled,
        ActivityAction.AutoBuybackEnabled,
      ]);
      expect(audit.record).toHaveBeenCalledTimes(3);
    });

    it('writes nothing for a flag sent at the value it already has', async () => {
      build(base({ tradingEnabled: true, autoBuybackEnabled: true }));

      await service.update(
        uuidOf(1),
        { tradingEnabled: true, autoBuybackEnabled: true },
        { actorUserId: uuidOf(9) },
      );

      expect(activityCalls()).toEqual([]);
    });

    it('writes nothing for flags that are not in the catalog', async () => {
      build(base());

      await service.update(
        uuidOf(1),
        { trustedUser: true, autoBuybackConcurrent: 4 },
        { actorUserId: uuidOf(9) },
      );

      expect(activityCalls()).toEqual([]);
    });

    it('fails the whole update when an activity row cannot be written', async () => {
      build(base());
      audit.record.mockImplementation(async (entry) => {
        if (String(entry.action).startsWith('activity.')) {
          throw new Error('audit down');
        }
      });

      await expect(
        service.update(
          uuidOf(1),
          { tradingEnabled: true },
          { actorUserId: uuidOf(9) },
        ),
      ).rejects.toThrow('audit down');
    });
  });

  it('enables auto-buyback with its concurrency and audits the change', async () => {
    build(base());

    const result = await service.update(
      uuidOf(1),
      { autoBuybackEnabled: true, autoBuybackConcurrent: 3 },
      { actorUserId: uuidOf(9), reason: 'ops' },
    );

    expect(result.autoBuybackEnabled).toBe(true);
    expect(result.autoBuybackConcurrent).toBe(3);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'trader_settings.auto_buyback_changed',
        reason: 'ops',
      }),
      manager,
    );
  });

  it('drops a concurrency sent while the flag stays off', async () => {
    build(base());

    const result = await service.update(
      uuidOf(1),
      { autoBuybackConcurrent: 5 },
      { actorUserId: uuidOf(9), reason: 'ops' },
    );

    expect(result.autoBuybackEnabled).toBe(false);
    expect(result.autoBuybackConcurrent).toBeNull();
  });

  it('nulls the concurrency when the flag is switched off', async () => {
    build(base({ autoBuybackEnabled: true, autoBuybackConcurrent: 3 }));

    const result = await service.update(
      uuidOf(1),
      { autoBuybackEnabled: false },
      { actorUserId: uuidOf(9), reason: 'ops' },
    );

    expect(result.autoBuybackConcurrent).toBeNull();
  });

  it('keeps a zero concurrency because it settles with ??', async () => {
    build(base({ autoBuybackEnabled: true, autoBuybackConcurrent: 5 }));

    const result = await service.update(
      uuidOf(1),
      { autoBuybackConcurrent: 0 },
      { actorUserId: uuidOf(9), reason: 'ops' },
    );

    expect(result.autoBuybackConcurrent).toBe(0);
  });

  describe('insurancePayInMin', () => {
    it('sets a personal minimum', async () => {
      build(base());

      const result = await service.update(
        uuidOf(1),
        { insurancePayInMin: 1000 },
        { actorUserId: uuidOf(9) },
      );

      expect(result.insurancePayInMin).toBe(1000);
    });

    it('keeps a zero minimum because it is a real value', async () => {
      build(base({ insurancePayInMin: 700 }));

      const result = await service.update(
        uuidOf(1),
        { insurancePayInMin: 0 },
        { actorUserId: uuidOf(9) },
      );

      expect(result.insurancePayInMin).toBe(0);
    });

    it('resets to the global default on an explicit null', async () => {
      build(base({ insurancePayInMin: 700 }));

      const result = await service.update(
        uuidOf(1),
        { insurancePayInMin: null },
        { actorUserId: uuidOf(9) },
      );

      expect(result.insurancePayInMin).toBeNull();
    });

    it('leaves the minimum alone when it is not given', async () => {
      build(base({ insurancePayInMin: 700 }));

      const result = await service.update(
        uuidOf(1),
        { tradingEnabled: true },
        { actorUserId: uuidOf(9) },
      );

      expect(result.insurancePayInMin).toBe(700);
    });
  });

  describe('row locking and creation', () => {
    it('reads the row for update inside the transaction, so two edits cannot lose each other', async () => {
      build(base());

      await service.update(
        uuidOf(1),
        { tradingEnabled: true },
        { actorUserId: uuidOf(9) },
      );

      expect(manager.findOne).toHaveBeenCalledWith(TraderSettings, {
        where: { userId: uuidOf(1) },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('inserts a missing row ignoring a concurrent insert, then reads it back locked', async () => {
      build(base());
      manager.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(base());

      const result = await service.update(
        uuidOf(1),
        { tradingEnabled: true },
        { actorUserId: uuidOf(9) },
      );

      expect(inserted.values).toHaveBeenCalledWith({ userId: uuidOf(1) });
      expect(inserted.orIgnore).toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledTimes(2);
      expect(manager.findOne).toHaveBeenLastCalledWith(TraderSettings, {
        where: { userId: uuidOf(1) },
        lock: { mode: 'pessimistic_write' },
      });
      expect(result.tradingEnabled).toBe(true);
    });

    it('ensure returns the row a concurrent request inserted first', async () => {
      build(base());
      const winner = base({ id: 7 });
      repository.findOne.mockResolvedValueOnce(null);
      repository.findOneOrFail.mockResolvedValueOnce(winner);
      repository.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

      await expect(service.ensure(uuidOf(1))).resolves.toBe(winner);
    });

    it('ensure rethrows anything that is not a unique violation', async () => {
      build(base());
      repository.findOne.mockResolvedValueOnce(null);
      repository.save.mockRejectedValueOnce(new Error('connection lost'));

      await expect(service.ensure(uuidOf(1))).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('findOrDefaults', () => {
    it('returns the stored row', async () => {
      build(base());
      const row = base({ tradingEnabled: true });
      repository.findOne.mockResolvedValue(row);

      await expect(service.findOrDefaults(uuidOf(1))).resolves.toBe(row);
    });

    it('answers with the column defaults and writes nothing when there is no row', async () => {
      build(base());
      repository.findOne.mockResolvedValue(null);

      const result = await service.findOrDefaults(uuidOf(1));

      expect(repository.save).not.toHaveBeenCalled();
      expect(result.userId).toBe(uuidOf(1));

      const defaults = getMetadataArgsStorage()
        .columns.filter(
          (column) =>
            column.target === TraderSettings &&
            (column.options.default !== undefined ||
              column.options.nullable === true),
        )
        .map((column) => [column.propertyName, column.options.default ?? null]);

      expect(defaults.length).toBeGreaterThan(10);
      for (const [property, value] of defaults) {
        expect([property, result[property as keyof TraderSettings]]).toEqual([
          property,
          value,
        ]);
      }
    });
  });

  describe('findByUserIds', () => {
    it('does not query for an empty input', async () => {
      build(base());

      await expect(service.findByUserIds([])).resolves.toEqual([]);
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('fetches every requested row in one query', async () => {
      build(base());
      const rows = [base(), base({ id: 2, userId: uuidOf(2) })];
      repository.find.mockResolvedValue(rows);

      await expect(service.findByUserIds([uuidOf(1), uuidOf(2)])).resolves.toBe(
        rows,
      );
      expect(repository.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('insurancePayInMinOf', () => {
    beforeEach(() => build(base()));

    it('prefers the personal value', () => {
      expect(
        service.insurancePayInMinOf(base({ insurancePayInMin: 1000 })),
      ).toBe(1000);
    });

    it('honours a personal zero', () => {
      expect(service.insurancePayInMinOf(base({ insurancePayInMin: 0 }))).toBe(
        0,
      );
    });

    it('falls back to the global value without a personal one', () => {
      expect(service.insurancePayInMinOf(base())).toBe(GLOBAL_MIN);
    });

    it('falls back to the global value without a row', () => {
      expect(service.insurancePayInMinOf(null)).toBe(GLOBAL_MIN);
      expect(service.insurancePayInMinOf(undefined)).toBe(GLOBAL_MIN);
    });
  });

  describe('effectiveInsurancePayInMin', () => {
    beforeEach(() => build(base()));

    it('reads the personal value from the row', async () => {
      repository.findOne.mockResolvedValue(base({ insurancePayInMin: 250 }));

      await expect(service.effectiveInsurancePayInMin(uuidOf(1))).resolves.toBe(
        250,
      );
    });

    it('uses the global value when there is no row', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.effectiveInsurancePayInMin(uuidOf(1))).resolves.toBe(
        GLOBAL_MIN,
      );
    });
  });

  describe('insurancePayOutMin', () => {
    it('stores a personal minimum and audits it', async () => {
      build(base());

      const result = await service.update(
        uuidOf(1),
        { insurancePayOutMin: 800 },
        { actorUserId: uuidOf(9) },
      );

      expect(result.insurancePayOutMin).toBe(800);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'trader_settings.updated',
          metadata: { insurancePayOutMin: 800 },
        }),
        manager,
      );
    });

    it('stores zero', async () => {
      build(base());

      const result = await service.update(
        uuidOf(1),
        { insurancePayOutMin: 0 },
        { actorUserId: uuidOf(9) },
      );

      expect(result.insurancePayOutMin).toBe(0);
    });

    it('resets to null', async () => {
      build(base({ insurancePayOutMin: 700 }));

      const result = await service.update(
        uuidOf(1),
        { insurancePayOutMin: null },
        { actorUserId: uuidOf(9) },
      );

      expect(result.insurancePayOutMin).toBeNull();
    });

    it('leaves it alone when absent', async () => {
      build(base({ insurancePayOutMin: 700 }));

      const result = await service.update(
        uuidOf(1),
        { tradingEnabled: true },
        { actorUserId: uuidOf(9) },
      );

      expect(result.insurancePayOutMin).toBe(700);
    });
  });

  describe('insurancePayOutMinOf', () => {
    beforeEach(() => build(base()));

    it('prefers the personal value', () => {
      expect(
        service.insurancePayOutMinOf(base({ insurancePayOutMin: 1000 })),
      ).toBe(1000);
    });

    it('honours a personal zero', () => {
      expect(
        service.insurancePayOutMinOf(base({ insurancePayOutMin: 0 })),
      ).toBe(0);
    });

    it('falls back to the global value without a personal one or a row', () => {
      expect(service.insurancePayOutMinOf(base())).toBe(GLOBAL_PAY_OUT_MIN);
      expect(service.insurancePayOutMinOf(null)).toBe(GLOBAL_PAY_OUT_MIN);
      expect(service.insurancePayOutMinOf(undefined)).toBe(GLOBAL_PAY_OUT_MIN);
    });
  });

  describe('effectiveInsurancePayOutMin', () => {
    beforeEach(() => build(base()));

    it('reads the personal value from the row', async () => {
      repository.findOne.mockResolvedValue(base({ insurancePayOutMin: 250 }));

      await expect(
        service.effectiveInsurancePayOutMin(uuidOf(1)),
      ).resolves.toBe(250);
    });

    it('uses the global value when there is no row', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.effectiveInsurancePayOutMin(uuidOf(1)),
      ).resolves.toBe(GLOBAL_PAY_OUT_MIN);
    });
  });

  describe('night stop', () => {
    it('switches the stop off and on', async () => {
      build(base());

      const off = await service.update(
        uuidOf(1),
        { nightStopEnabled: false },
        { actorUserId: uuidOf(9) },
      );
      expect(off.nightStopEnabled).toBe(false);

      const on = await service.update(
        uuidOf(1),
        { nightStopEnabled: true },
        { actorUserId: uuidOf(9) },
      );
      expect(on.nightStopEnabled).toBe(true);
    });

    it('stores a personal threshold and audits it as a generic update', async () => {
      build(base());

      const result = await service.update(
        uuidOf(1),
        { nightStopThreshold: 5 },
        { actorUserId: uuidOf(9) },
      );

      expect(result.nightStopThreshold).toBe(5);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'trader_settings.updated',
          metadata: { nightStopThreshold: 5 },
        }),
        manager,
      );
    });

    it('resets the threshold to null', async () => {
      build(base({ nightStopThreshold: 4 }));

      const result = await service.update(
        uuidOf(1),
        { nightStopThreshold: null },
        { actorUserId: uuidOf(9) },
      );

      expect(result.nightStopThreshold).toBeNull();
    });

    it('leaves the threshold alone when absent', async () => {
      build(base({ nightStopThreshold: 4 }));

      const result = await service.update(
        uuidOf(1),
        { nightStopEnabled: false },
        { actorUserId: uuidOf(9) },
      );

      expect(result.nightStopThreshold).toBe(4);
    });

    it('resolves the threshold with ??, preferring the personal one', () => {
      build(base());

      expect(
        service.nightStopThresholdOf(base({ nightStopThreshold: 7 })),
      ).toBe(7);
      expect(service.nightStopThresholdOf(base())).toBe(GLOBAL_NIGHT_THRESHOLD);
      expect(service.nightStopThresholdOf(null)).toBe(GLOBAL_NIGHT_THRESHOLD);
      expect(service.nightStopThresholdOf(undefined)).toBe(
        GLOBAL_NIGHT_THRESHOLD,
      );
    });
  });
});

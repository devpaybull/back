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
      ...overrides,
    }) as TraderSettings;

  let current: TraderSettings;
  let manager: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let audit: { record: jest.Mock };
  let repository: { find: jest.Mock; findOne: jest.Mock };
  let service: TraderSettingsService;
  const GLOBAL_MIN = 500;

  const build = (seed: TraderSettings) => {
    current = seed;
    manager = {
      findOne: jest.fn(async () => current),
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (row) => row),
    };
    dataSource = { transaction: jest.fn(async (cb) => cb(manager)) };
    audit = { record: jest.fn() };
    repository = { find: jest.fn(async () => []), findOne: jest.fn() };
    service = new TraderSettingsService(
      repository as never,
      dataSource as never,
      audit as never,
      { get: jest.fn(() => GLOBAL_MIN) } as never,
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
});

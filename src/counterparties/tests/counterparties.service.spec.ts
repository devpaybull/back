import { In, Repository } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { CounterpartyRequisiteEvent } from '../entities/counterparty-requisite-event.entity';
import { CounterpartyBindingType } from '../types/counterparty-binding-type.enum';
import { CounterpartySortField } from '../types/counterparty-sort-field.enum';
import { RequisiteEventKind } from '../types/requisite-event-kind.enum';
import { RequisiteEventReason } from '../types/requisite-event-reason.enum';
import { RequisiteEventSource } from '../types/requisite-event-source.enum';
import { CounterpartiesService } from '../services/counterparties.service';
import { Counterparty } from '../entities/counterparty.entity';

describe('CounterpartiesService', () => {
  let repository: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let insert: { values: jest.Mock; orIgnore: jest.Mock; execute: jest.Mock };
  let service: CounterpartiesService;

  beforeEach(() => {
    insert = {
      values: jest.fn(() => insert),
      orIgnore: jest.fn(() => insert),
      execute: jest.fn(async () => undefined),
    };
    repository = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(async () => ({ id: 1 })),
      createQueryBuilder: jest.fn(() => ({ insert: () => insert })),
    };
    service = new CounterpartiesService(
      repository as unknown as Repository<Counterparty>,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  describe('findOrCreate', () => {
    it('returns the existing record for the same merchant and external id', async () => {
      const existing = { id: 7 } as Counterparty;
      repository.findOne.mockResolvedValue(existing);

      const result = await service.findOrCreate('merchant-1', 'ext-42');

      expect(result).toBe(existing);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('inserts with ON CONFLICT DO NOTHING and re-reads, so a parallel creation of the same client gets the same row', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.findOrCreate('merchant-1', 'ext-42', {
        name: 'Ivan',
        contact: 'ivan@example.com',
      });

      expect(insert.values).toHaveBeenCalledWith({
        merchantId: 'merchant-1',
        externalId: 'ext-42',
        name: 'Ivan',
        contact: 'ivan@example.com',
        payload: null,
      });
      expect(insert.orIgnore).toHaveBeenCalled();
      expect(repository.findOneOrFail).toHaveBeenCalledWith({
        where: { merchantId: 'merchant-1', externalId: 'ext-42' },
      });
      expect(result.id).toBe(1);
    });

    it('scopes the lookup to the merchant and external id pair', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.findOrCreate('merchant-9', 'ext-42');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { merchantId: 'merchant-9', externalId: 'ext-42' },
      });
    });

    it('defaults optional fields to null', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.findOrCreate('merchant-1', 'ext-1');

      expect(insert.values).toHaveBeenCalledWith({
        merchantId: 'merchant-1',
        externalId: 'ext-1',
        name: null,
        contact: null,
        payload: null,
      });
    });
  });
});

describe('CounterpartiesService.findByIds', () => {
  it('reads every asked-for counterparty in one query', async () => {
    const rows = [{ id: 5 }, { id: 6 }] as Counterparty[];
    const repository = { find: jest.fn(async () => rows) };
    const service = new CounterpartiesService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.findByIds([5, 6])).resolves.toBe(rows);
    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith({ where: { id: In([5, 6]) } });
  });

  it('answers an empty id list without querying', async () => {
    const repository = { find: jest.fn() };
    const service = new CounterpartiesService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.findByIds([])).resolves.toEqual([]);
    expect(repository.find).not.toHaveBeenCalled();
  });
});

describe('CounterpartiesService mutations and reads', () => {
  const actor = uuidOf(900);
  const merchantId = uuidOf(10);
  const traderId = uuidOf(20);
  let stored: Record<string, unknown> | null;
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    transaction: jest.Mock;
    query: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let repository: {
    manager: typeof manager;
    createQueryBuilder: jest.Mock;
  };
  let dailyVolumes: { createQueryBuilder: jest.Mock };
  let service: CounterpartiesService;

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 5,
    merchantId,
    enabled: true,
    blacklistedAt: null,
    blacklistedByUserId: null,
    autoEnableForbidden: false,
    bankDetailsId: null,
    bindingType: null,
    boundAt: null,
    boundByUserId: null,
    ...overrides,
  });

  const requisite = (overrides: Record<string, unknown> = {}) => ({
    id: uuidOf(30),
    type: BankDetailsType.CardOrSbp,
    card: '4400430212345678',
    phone: null,
    counterpartyOnly: true,
    maxCounterparties: null,
    userId: traderId,
    ...overrides,
  });

  const eventsSaved = (): Record<string, unknown>[] =>
    manager.create.mock.calls
      .filter(([entity]) => entity === CounterpartyRequisiteEvent)
      .map(([, event]) => event);

  const actionsAudited = (): string[] =>
    audit.record.mock.calls.map(([entry]) => entry.action);

  beforeEach(() => {
    stored = row();
    manager = {
      findOne: jest.fn(async () => stored),
      find: jest.fn(),
      count: jest.fn(async () => 0),
      save: jest.fn(async (entity) => entity),
      create: jest.fn((_entity, data) => data),
      transaction: jest.fn(),
      query: jest.fn(),
    };
    manager.transaction.mockImplementation(async (work) => work(manager));
    audit = { record: jest.fn(async () => undefined) };
    repository = { manager, createQueryBuilder: jest.fn() };
    dailyVolumes = { createQueryBuilder: jest.fn() };
    service = new CounterpartiesService(
      repository as never,
      dailyVolumes as never,
      {} as never,
      audit as never,
      { get: jest.fn(() => 'Europe/Moscow') } as never,
    );
  });

  describe('update', () => {
    it('rejects a body without any change', async () => {
      await expect(service.update(5, { reason: 'x' }, actor)).rejects.toThrow(
        'No changes were given',
      );
      expect(manager.transaction).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown counterparty', async () => {
      stored = null;

      await expect(
        service.update(5, { enabled: false }, actor),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('locks the row with a pessimistic write before changing it', async () => {
      await service.update(5, { enabled: false }, actor);

      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { id: 5 },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('blacklists and disables in one save', async () => {
      await service.update(5, { blacklisted: true }, actor);

      expect(stored).toMatchObject({
        enabled: false,
        blacklistedByUserId: actor,
      });
      expect(stored.blacklistedAt).toBeInstanceOf(Date);
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('writes a blacklisted and a disabled audit row with the reason', async () => {
      await service.update(5, { blacklisted: true, reason: 'fraud' }, actor);

      expect(actionsAudited()).toEqual([
        'counterparty.blacklisted',
        'counterparty.disabled',
      ]);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: actor,
          action: 'counterparty.blacklisted',
          reason: 'fraud',
          metadata: { counterpartyId: 5, merchantId },
        },
        manager,
      );
    });

    it('records a null reason when none is given', async () => {
      await service.update(5, { enabled: false }, actor);

      expect(audit.record.mock.calls[0][0].reason).toBeNull();
    });

    it('refuses to enable a counterparty that is stored as blacklisted', async () => {
      stored = row({ enabled: false, blacklistedAt: new Date() });

      await expect(
        service.update(5, { enabled: true }, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses to enable and blacklist in the same body', async () => {
      await expect(
        service.update(5, { enabled: true, blacklisted: true }, actor),
      ).rejects.toMatchObject({ status: 409 });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('leaves the counterparty disabled after it is unblacklisted', async () => {
      stored = row({
        enabled: false,
        blacklistedAt: new Date(),
        blacklistedByUserId: actor,
      });

      await service.update(5, { blacklisted: false }, actor);

      expect(stored).toMatchObject({
        enabled: false,
        blacklistedAt: null,
        blacklistedByUserId: null,
      });
      expect(actionsAudited()).toEqual(['counterparty.unblacklisted']);
    });

    it('enables a disabled counterparty that is not blacklisted', async () => {
      stored = row({ enabled: false });

      await service.update(5, { enabled: true }, actor);

      expect(actionsAudited()).toEqual(['counterparty.enabled']);
    });

    it('writes no audit and no save when the value already matches', async () => {
      await service.update(5, { enabled: true }, actor);

      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('forbids auto enabling with its own action name', async () => {
      await service.update(5, { autoEnableForbidden: true }, actor);

      expect(stored.autoEnableForbidden).toBe(true);
      expect(actionsAudited()).toEqual(['counterparty.auto_enable_forbidden']);
    });

    it('allows auto enabling again with its own action name', async () => {
      stored = row({ autoEnableForbidden: true });

      await service.update(5, { autoEnableForbidden: false }, actor);

      expect(actionsAudited()).toEqual(['counterparty.auto_enable_allowed']);
    });
  });

  describe('bindWithin', () => {
    it('refuses a counterparty that already has a requisite', async () => {
      stored = row({ bankDetailsId: uuidOf(31) });

      await expect(
        service.bindWithin(
          manager as never,
          5,
          requisite(),
          CounterpartyBindingType.Cards,
          actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses a requisite that is not counterparty-only', async () => {
      await expect(
        service.bindWithin(
          manager as never,
          5,
          requisite({ counterpartyOnly: false }),
          CounterpartyBindingType.Cards,
          actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('refuses a binding type that excludes the requisite channel', async () => {
      await expect(
        service.bindWithin(
          manager as never,
          5,
          requisite(),
          CounterpartyBindingType.Sbp,
          actor,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('stores the binding fields on success', async () => {
      await service.bindWithin(
        manager as never,
        5,
        requisite(),
        CounterpartyBindingType.CardsOrSbp,
        actor,
      );

      expect(stored).toMatchObject({
        bankDetailsId: uuidOf(30),
        bindingType: CounterpartyBindingType.CardsOrSbp,
        boundByUserId: actor,
      });
      expect(stored.boundAt).toBeInstanceOf(Date);
    });

    it('binds as the system when there is no actor, the deal issue being the reason', async () => {
      await service.bindWithin(
        manager as never,
        5,
        requisite(),
        CounterpartyBindingType.CardsOrSbp,
        null,
      );

      expect(stored).toMatchObject({ boundByUserId: null });
      expect(eventsSaved()).toEqual([
        {
          counterpartyId: 5,
          bankDetailsId: uuidOf(30),
          kind: RequisiteEventKind.Bound,
          source: RequisiteEventSource.System,
          reason: RequisiteEventReason.DealIssued,
          actorUserId: null,
        },
      ]);
    });

    it('writes a manual bound event without a reason', async () => {
      await service.bindWithin(
        manager as never,
        5,
        requisite(),
        CounterpartyBindingType.Cards,
        actor,
      );

      expect(eventsSaved()).toEqual([
        {
          counterpartyId: 5,
          bankDetailsId: uuidOf(30),
          kind: RequisiteEventKind.Bound,
          source: RequisiteEventSource.Manual,
          reason: null,
          actorUserId: actor,
        },
      ]);
    });

    it('audits the binding', async () => {
      await service.bindWithin(
        manager as never,
        5,
        requisite(),
        CounterpartyBindingType.Cards,
        actor,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'counterparty.requisite_bound',
          actorUserId: actor,
        }),
        manager,
      );
    });
  });

  describe('counterparty slots', () => {
    it('refuses a bind with 409 once the requisite holds maxCounterparties', async () => {
      manager.count.mockResolvedValue(2);

      await expect(
        service.bindWithin(
          manager as never,
          5,
          requisite({ maxCounterparties: 2 }),
          CounterpartyBindingType.Cards,
          actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(manager.count).toHaveBeenCalledWith(Counterparty, {
        where: { bankDetailsId: uuidOf(30) },
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('binds while a slot is free', async () => {
      manager.count.mockResolvedValue(1);

      await service.bindWithin(
        manager as never,
        5,
        requisite({ maxCounterparties: 2 }),
        CounterpartyBindingType.Cards,
        actor,
      );

      expect(stored.bankDetailsId).toBe(uuidOf(30));
    });

    it('refuses moving a counterparty onto a full requisite', async () => {
      stored = row({
        bankDetailsId: uuidOf(31),
        bindingType: CounterpartyBindingType.Cards,
      });
      manager.count.mockResolvedValue(1);

      await expect(
        service.replaceWithin(
          manager as never,
          5,
          requisite({ maxCounterparties: 1 }),
          actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(stored.bankDetailsId).toBe(uuidOf(31));
    });
  });

  describe('replaceWithin', () => {
    const bound = () =>
      row({
        bankDetailsId: uuidOf(31),
        bindingType: CounterpartyBindingType.Cards,
      });

    it('refuses a counterparty without a binding', async () => {
      await expect(
        service.replaceWithin(manager as never, 5, requisite(), actor),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('refuses the requisite that is already bound', async () => {
      stored = bound();

      await expect(
        service.replaceWithin(
          manager as never,
          5,
          requisite({ id: uuidOf(31) }),
          actor,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('refuses a channel the stored binding type does not allow', async () => {
      stored = bound();

      await expect(
        service.replaceWithin(
          manager as never,
          5,
          requisite({ card: null, phone: '79001234567' }),
          actor,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('writes an unbound event for the old and a bound event for the new requisite', async () => {
      stored = bound();

      await service.replaceWithin(manager as never, 5, requisite(), actor);

      expect(eventsSaved()).toEqual([
        expect.objectContaining({
          bankDetailsId: uuidOf(31),
          kind: RequisiteEventKind.Unbound,
          reason: RequisiteEventReason.Replaced,
          source: RequisiteEventSource.Manual,
        }),
        expect.objectContaining({
          bankDetailsId: uuidOf(30),
          kind: RequisiteEventKind.Bound,
          reason: RequisiteEventReason.Replaced,
          source: RequisiteEventSource.Manual,
        }),
      ]);
    });

    it('points the counterparty at the new requisite and audits it', async () => {
      stored = bound();

      await service.replaceWithin(manager as never, 5, requisite(), actor);

      expect(stored).toMatchObject({
        bankDetailsId: uuidOf(30),
        boundByUserId: actor,
      });
      expect(actionsAudited()).toEqual(['counterparty.requisite_replaced']);
    });
  });

  describe('unbind', () => {
    it('answers 404 when nothing is bound', async () => {
      await expect(service.unbind(5, actor)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('clears all four binding fields', async () => {
      stored = row({
        bankDetailsId: uuidOf(31),
        bindingType: CounterpartyBindingType.Sbp,
        boundAt: new Date(),
        boundByUserId: actor,
      });

      await service.unbind(5, actor);

      expect(stored).toMatchObject({
        bankDetailsId: null,
        bindingType: null,
        boundAt: null,
        boundByUserId: null,
      });
    });

    it('writes a manual unbound event and an audit row', async () => {
      stored = row({ bankDetailsId: uuidOf(31) });

      await service.unbind(5, actor);

      expect(eventsSaved()).toEqual([
        {
          counterpartyId: 5,
          bankDetailsId: uuidOf(31),
          kind: RequisiteEventKind.Unbound,
          source: RequisiteEventSource.Manual,
          reason: null,
          actorUserId: actor,
        },
      ]);
      expect(actionsAudited()).toEqual(['counterparty.requisite_unbound']);
    });
  });

  describe('unbindRequisiteWithin', () => {
    it('clears every counterparty bound to the requisite as the system', async () => {
      const first = row({ id: 1, bankDetailsId: uuidOf(30) });
      const second = row({ id: 2, bankDetailsId: uuidOf(30) });
      manager.find.mockResolvedValue([first, second]);

      await service.unbindRequisiteWithin(
        manager as never,
        uuidOf(30),
        RequisiteEventReason.RequisiteDeleted,
      );

      expect(first.bankDetailsId).toBeNull();
      expect(second.bankDetailsId).toBeNull();
      expect(eventsSaved()).toEqual([
        {
          counterpartyId: 1,
          bankDetailsId: uuidOf(30),
          kind: RequisiteEventKind.Unbound,
          source: RequisiteEventSource.System,
          reason: RequisiteEventReason.RequisiteDeleted,
          actorUserId: null,
        },
        expect.objectContaining({ counterpartyId: 2, actorUserId: null }),
      ]);
    });

    it('writes no audit row', async () => {
      manager.find.mockResolvedValue([row({ bankDetailsId: uuidOf(30) })]);

      await service.unbindRequisiteWithin(
        manager as never,
        uuidOf(30),
        RequisiteEventReason.CounterpartyOnlyCleared,
      );

      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const query = {
      page: 1,
      limit: 20,
      sortBy: CounterpartySortField.Id,
      sortOrder: SortOrder.Desc,
    };

    it('answers an empty page for an empty requisite filter without a query', async () => {
      const page = await service.list(
        { ...query, bankDetailsIds: [] },
        new Date(),
      );

      expect(page.items).toEqual([]);
      expect(page.meta.total).toBe(0);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('countByStatus', () => {
    const builder = (rows: unknown[]) => {
      const chain: Record<string, jest.Mock> = {};
      for (const name of [
        'setParameters',
        'andWhere',
        'select',
        'addSelect',
        'groupBy',
      ]) {
        chain[name] = jest.fn(() => chain);
      }
      chain.getRawMany = jest.fn(async () => rows);
      return chain;
    };

    it('maps the grouped rows to all, enabled and disabled', async () => {
      repository.createQueryBuilder.mockReturnValue(
        builder([
          { enabled: true, count: '3' },
          { enabled: false, count: '4' },
        ]),
      );

      await expect(service.countByStatus({}, new Date())).resolves.toEqual({
        all: 7,
        enabled: 3,
        disabled: 4,
      });
    });

    it('counts a missing group as zero', async () => {
      repository.createQueryBuilder.mockReturnValue(
        builder([{ enabled: true, count: '2' }]),
      );

      await expect(service.countByStatus({}, new Date())).resolves.toEqual({
        all: 2,
        enabled: 2,
        disabled: 0,
      });
    });

    it('ignores the status filter', async () => {
      const chain = builder([]);
      repository.createQueryBuilder.mockReturnValue(chain);

      await service.countByStatus({ status: 'enabled' as never }, new Date());

      const parameters = chain.andWhere.mock.calls.map(([sql]) => sql);
      expect(parameters).not.toContain('counterparty.enabled = :enabled');
    });

    it('answers zeros for an empty requisite filter without a query', async () => {
      await expect(
        service.countByStatus({ bankDetailsIds: [] }, new Date()),
      ).resolves.toEqual({ all: 0, enabled: 0, disabled: 0 });
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('windowVolumesOf', () => {
    it('answers an empty map for no ids without querying', async () => {
      const result = await service.windowVolumesOf([], new Date());

      expect(result.size).toBe(0);
      expect(dailyVolumes.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('gives ids without rows zero volumes', async () => {
      const chain: Record<string, jest.Mock> = {};
      for (const name of [
        'select',
        'addSelect',
        'where',
        'andWhere',
        'setParameter',
        'groupBy',
      ]) {
        chain[name] = jest.fn(() => chain);
      }
      chain.getRawMany = jest.fn(async () => [
        { counterpartyId: 1, volume7d: '10.50', volume30d: '99.00' },
      ]);
      dailyVolumes.createQueryBuilder.mockReturnValue(chain);

      const result = await service.windowVolumesOf([1, 2], new Date());

      expect(result.get(1)).toEqual({
        volume7d: expect.anything(),
        volume30d: expect.anything(),
      });
      expect(result.get(1).volume7d.toFixed(2)).toBe('10.50');
      expect(result.get(2).volume7d.toFixed(2)).toBe('0.00');
      expect(result.get(2).volume30d.toFixed(2)).toBe('0.00');
    });
  });
});

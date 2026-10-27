import { ConflictException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantGroup } from '../entities/merchant-group.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantsService } from '../services/merchants.service';
import { MerchantStatus } from '../types/merchant-status.enum';

describe('MerchantsService', () => {
  let merchants: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
  };
  let keys: { create: jest.Mock; save: jest.Mock };
  let service: MerchantsService;

  beforeEach(() => {
    merchants = {
      find: jest.fn(async () => []),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'm1', ...data })),
      findAndCount: jest.fn(async () => [[], 0]),
    };
    keys = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 1, ...data })),
    };
    service = new MerchantsService(
      merchants as never,
      keys as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('creates a merchant by name', async () => {
    const result = await service.create('Acme');

    expect(merchants.create).toHaveBeenCalledWith({ name: 'Acme' });
    expect(result.id).toBe('m1');
  });

  it('creates through the given transaction when one is passed', async () => {
    const inTransaction = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'm2', ...data })),
    };
    const manager = { getRepository: jest.fn(() => inTransaction) };

    const result = await service.create('Acme', manager as never);

    expect(inTransaction.save).toHaveBeenCalledWith({ name: 'Acme' });
    expect(merchants.save).not.toHaveBeenCalled();
    expect(result.id).toBe('m2');
  });

  it('reads every merchant of the given ids in one query', async () => {
    await service.findByIds(['m1', 'm2']);

    expect(merchants.find).toHaveBeenCalledTimes(1);
    expect(merchants.find).toHaveBeenCalledWith({
      where: { id: In(['m1', 'm2']) },
    });
  });

  it('asks nothing for an empty list of ids', async () => {
    await expect(service.findByIds([])).resolves.toEqual([]);
    expect(merchants.find).not.toHaveBeenCalled();
  });
});

describe('MerchantsService.rankByName', () => {
  it('ranks every merchant by name in one query, equal names sharing a rank', async () => {
    const repository = {
      find: jest.fn(async () => [
        { id: 'a', name: 'Acme' },
        { id: 'b', name: 'Acme' },
        { id: 'c', name: 'Beta' },
        { id: 'd', name: 'Zeta' },
      ]),
    };
    const service = new MerchantsService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const ranks = await service.rankByName();

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith({
      select: { id: true, name: true },
      order: { name: 'ASC', id: 'ASC' },
    });
    expect([...ranks.entries()]).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 1],
      ['d', 2],
    ]);
  });

  it('answers an empty ranking when there are no merchants', async () => {
    const repository = { find: jest.fn(async () => []) };
    const service = new MerchantsService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.rankByName()).resolves.toEqual(new Map());
  });
});

describe('MerchantsService.listTree', () => {
  const group = (id: number, name: string) =>
    ({ id, name, createdAt: new Date(0) }) as MerchantGroup;
  const merchant = (n: number, overrides: Partial<Merchant> = {}): Merchant =>
    ({
      id: uuidOf(n),
      name: `Casino ${n}`,
      internalName: null,
      active: true,
      exclusiveTopUp: false,
      group: null,
      groupId: null,
      createdAt: new Date(n * 1000),
      ...overrides,
    }) as Merchant;

  const casinos = group(1, 'Группа мерчантов');
  const rows = [
    merchant(1, { group: casinos, groupId: 1 }),
    merchant(2, { group: casinos, groupId: 1, active: false }),
    merchant(3, { name: 'Мерчант соло', internalName: 'solo-int' }),
    merchant(4, { exclusiveTopUp: true }),
  ];
  const build = () => {
    const repository = { find: jest.fn(async () => rows) };

    return {
      repository,
      service: new MerchantsService(
        repository as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  };

  it('reads every merchant with its group in one query and nests group members under one node', async () => {
    const { repository, service } = build();

    const nodes = await service.listTree({});

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith({
      relations: { group: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    expect(nodes.map((node) => node.kind)).toEqual([
      'group',
      'merchant',
      'merchant',
    ]);
    const first = nodes[0];
    expect(first.kind === 'group' && first.members.length).toBe(2);
  });

  it('filters merchants by status but keeps every member for the group aggregates', async () => {
    const { service } = build();

    const [first, ...rest] = await service.listTree({
      status: MerchantStatus.Inactive,
    });

    expect(rest).toEqual([]);
    expect(first.kind).toBe('group');
    if (first.kind === 'group') {
      expect(first.shown.map((row) => row.id)).toEqual([uuidOf(2)]);
      expect(first.members).toHaveLength(2);
    }
  });

  it('filters by the «Искл. залив» flag', async () => {
    const { service } = build();

    const nodes = await service.listTree({ exclusiveTopUp: true });

    expect(nodes).toEqual([{ kind: 'merchant', merchant: rows[3] }]);
  });

  it('searches the internal name, case-insensitively', async () => {
    const { service } = build();

    const nodes = await service.listTree({ search: 'SOLO-INT' });

    expect(nodes).toEqual([{ kind: 'merchant', merchant: rows[2] }]);
  });

  it('searches by a part of the id', async () => {
    const { service } = build();

    const nodes = await service.listTree({ search: uuidOf(4).slice(-6) });

    expect(nodes).toEqual([{ kind: 'merchant', merchant: rows[3] }]);
  });

  it('gives a group whose own name matches with all of its merchants', async () => {
    const { service } = build();

    const [node, ...rest] = await service.listTree({ search: 'группа' });

    expect(rest).toEqual([]);
    expect(node.kind === 'group' && node.shown).toHaveLength(2);
  });

  it('gives a group with only the merchants that matched by their own fields', async () => {
    const { service } = build();

    const [node] = await service.listTree({ search: 'casino 2' });

    expect(node.kind === 'group' && node.shown.map((row) => row.id)).toEqual([
      uuidOf(2),
    ]);
  });

  it('treats % and _ in the term literally', async () => {
    const { service } = build();

    await expect(service.listTree({ search: '%' })).resolves.toEqual([]);
  });
});

describe('MerchantsService.update', () => {
  const build = (stored: Merchant | null) => {
    const manager = {
      findOne: jest.fn(async () => stored),
      update: jest.fn(async () => undefined),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
        work(manager),
      ),
    };
    const repository = { findOne: jest.fn(async () => stored) };
    const groups = {
      moveWithin: jest.fn(async () => undefined),
      lockGroupsWithin: jest.fn(async () => undefined),
    };
    const currencies = {
      assertCurrenciesExistWithin: jest.fn(async () => undefined),
      replaceWithin: jest.fn(async () => undefined),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new MerchantsService(
      repository as never,
      {} as never,
      dataSource as never,
      groups as never,
      currencies as never,
      audit as never,
    );

    return { manager, groups, currencies, audit, service };
  };

  const stored = { id: uuidOf(1), groupId: null } as Merchant;

  it('writes only the fields that were given, under a lock, with the audit in the same transaction', async () => {
    const { manager, audit, groups, service } = build(stored);

    await service.update(
      uuidOf(1),
      { active: false, internalName: null },
      uuidOf(9),
    );

    expect(manager.findOne).toHaveBeenCalledWith(Merchant, {
      where: { id: uuidOf(1) },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.update).toHaveBeenCalledWith(Merchant, uuidOf(1), {
      active: false,
      internalName: null,
    });
    expect(groups.moveWithin).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: uuidOf(9),
        action: 'merchant.updated',
        metadata: { merchantId: uuidOf(1), active: false, internalName: null },
      }),
      manager,
    );
  });

  it('checks the currencies exist and replaces them inside the transaction', async () => {
    const { manager, currencies, service } = build(stored);

    await service.update(
      uuidOf(1),
      { currencyIds: [1, 2], defaultCurrencyId: 2 },
      uuidOf(9),
    );

    expect(currencies.assertCurrenciesExistWithin).toHaveBeenCalledWith(
      manager,
      [1, 2],
    );
    expect(currencies.replaceWithin).toHaveBeenCalledWith(manager, uuidOf(1), {
      currencyIds: [1, 2],
      defaultCurrencyId: 2,
    });
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('changes only the default currency inside the transaction', async () => {
    const { manager, currencies, service } = build(stored);

    await service.update(uuidOf(1), { defaultCurrencyId: 2 }, uuidOf(9));

    expect(currencies.assertCurrenciesExistWithin).not.toHaveBeenCalled();
    expect(currencies.replaceWithin).toHaveBeenCalledWith(manager, uuidOf(1), {
      currencyIds: undefined,
      defaultCurrencyId: 2,
    });
  });

  it('leaves the currencies alone when none are given', async () => {
    const { currencies, service } = build(stored);

    await service.update(uuidOf(1), { active: true }, uuidOf(9));

    expect(currencies.replaceWithin).not.toHaveBeenCalled();
  });

  it('locks the groups before the merchant and moves it through the groups service when a group is given', async () => {
    const { manager, groups, service } = build(stored);

    await service.update(uuidOf(1), { groupId: 4 }, uuidOf(9));

    expect(groups.lockGroupsWithin).toHaveBeenCalledWith(manager, [null, 4]);
    expect(groups.lockGroupsWithin.mock.invocationCallOrder[0]).toBeLessThan(
      manager.findOne.mock.invocationCallOrder[1],
    );
    expect(manager.findOne).toHaveBeenLastCalledWith(Merchant, {
      where: { id: uuidOf(1) },
      lock: { mode: 'pessimistic_write' },
    });
    expect(groups.moveWithin).toHaveBeenCalledWith(
      manager,
      stored,
      4,
      uuidOf(9),
    );
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('refuses with a 409 when the group changed between the read and the lock', async () => {
    const { manager, groups, service } = build(stored);
    manager.findOne
      .mockResolvedValueOnce({ ...stored, groupId: 2 } as Merchant)
      .mockResolvedValueOnce({ ...stored, groupId: 3 } as Merchant);

    await expect(
      service.update(uuidOf(1), { groupId: null }, uuidOf(9)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(groups.lockGroupsWithin).toHaveBeenCalledWith(manager, [2, null]);
    expect(groups.moveWithin).not.toHaveBeenCalled();
  });

  it('locks no group when the group is not touched', async () => {
    const { groups, service } = build(stored);

    await service.update(uuidOf(1), { active: true }, uuidOf(9));

    expect(groups.lockGroupsWithin).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown merchant and writes nothing', async () => {
    const { manager, audit, service } = build(null);

    await expect(
      service.update(uuidOf(1), { active: true }, uuidOf(9)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('MerchantsService, API keys', () => {
  const MERCHANT = uuidOf(1);
  const ACTOR = uuidOf(9);

  const build = (merchantExists = true, key: object | null = null) => {
    const manager = {
      findOne: jest.fn(async (entity: unknown) =>
        entity === Merchant ? (merchantExists ? { id: MERCHANT } : null) : key,
      ),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn(async (row: object) => ({ id: 5, ...row })),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
        work(manager),
      ),
    };
    const keys = { find: jest.fn(async () => []) };
    const audit = { record: jest.fn(async () => undefined) };

    return {
      manager,
      keys,
      audit,
      service: new MerchantsService(
        {} as never,
        keys as never,
        dataSource as never,
        {} as never,
        {} as never,
        audit as never,
      ),
    };
  };

  it('issues a key with a uuid key and a long hex secret, audited without the secret', async () => {
    const { service, manager, audit } = build();

    const issued = await service.createKey(MERCHANT, ACTOR);

    expect(issued.merchantId).toBe(MERCHANT);
    expect(issued.key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(issued.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorUserId: ACTOR,
        action: 'merchant.api_key_issued',
        metadata: { merchantId: MERCHANT, apiKeyId: 5 },
      },
      manager,
    );
  });

  it('refuses a key for an unknown merchant with a 404', async () => {
    const { service, manager } = build(false);

    await expect(service.createKey(MERCHANT, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('lists the keys newest first', async () => {
    const { service, keys } = build();

    await service.listKeys(MERCHANT);

    expect(keys.find).toHaveBeenCalledWith({
      where: { merchantId: MERCHANT },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  });

  it('revokes an active key with the audit row in the same transaction', async () => {
    const stored = { id: 5, merchantId: MERCHANT, key: 'k', active: true };
    const { service, manager, audit } = build(true, stored);

    const revoked = await service.revokeKey(MERCHANT, 5, ACTOR);

    expect(revoked.active).toBe(false);
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorUserId: ACTOR,
        action: 'merchant.api_key_revoked',
        metadata: { merchantId: MERCHANT, apiKeyId: 5 },
      },
      manager,
    );
  });

  it('changes nothing for a key already revoked', async () => {
    const stored = { id: 5, merchantId: MERCHANT, key: 'k', active: false };
    const { service, manager, audit } = build(true, stored);

    await service.revokeKey(MERCHANT, 5, ACTOR);

    expect(manager.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 404 for a key of another merchant', async () => {
    const { service } = build(true, null);

    await expect(service.revokeKey(MERCHANT, 5, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

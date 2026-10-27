import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { MerchantGroup } from '../entities/merchant-group.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantGroupsService } from '../services/merchant-groups.service';
import { MerchantGroupSortField } from '../types/merchant-group-sort-field.enum';

const ACTOR = uuidOf(9);

const build = (
  options: {
    group?: MerchantGroup | null;
    nameClash?: MerchantGroup | null;
    merchants?: Merchant[];
    affected?: number;
    left?: number;
  } = {},
) => {
  const group =
    options.group === undefined
      ? ({ id: 1, name: 'Группа', nameKey: 'группа' } as MerchantGroup)
      : options.group;
  const merchants = options.merchants ?? [];
  const updateBuilder = {
    update: jest.fn(() => updateBuilder),
    set: jest.fn(() => updateBuilder),
    where: jest.fn(() => updateBuilder),
    andWhere: jest.fn(() => updateBuilder),
    execute: jest.fn(async () => ({
      affected: options.affected ?? merchants.length,
    })),
  };
  const manager = {
    findOne: jest.fn(
      async (
        entity: unknown,
        { where }: { where: Record<string, unknown> },
      ): Promise<unknown> => {
        if (entity === MerchantGroup) {
          return 'nameKey' in where ? (options.nameClash ?? null) : group;
        }

        return merchants.find((row) => row.id === where.id) ?? null;
      },
    ),
    find: jest.fn(async (entity: unknown) =>
      entity === Merchant ? merchants : [],
    ),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (row: object) => ({ id: 5, ...row })),
    update: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    count: jest.fn(async () => options.left ?? 1),
    createQueryBuilder: jest.fn(() => updateBuilder),
  };
  const dataSource = {
    manager,
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const groupsRepository = {
    findOne: jest.fn(async () => group),
    findAndCount: jest.fn(async () => [[group], 1]),
  };
  const countBuilder = {
    select: jest.fn(() => countBuilder),
    addSelect: jest.fn(() => countBuilder),
    where: jest.fn(() => countBuilder),
    groupBy: jest.fn(() => countBuilder),
    getRawMany: jest.fn(async () => [{ groupId: 1, count: '3' }]),
  };
  const merchantsRepository = {
    createQueryBuilder: jest.fn(() => countBuilder),
  };
  const service = new MerchantGroupsService(
    groupsRepository as never,
    merchantsRepository as never,
    dataSource as never,
    audit as never,
  );

  return { service, manager, audit, updateBuilder, groupsRepository };
};

const merchant = (n: number, groupId: number | null = null) =>
  ({ id: uuidOf(n), name: `Casino ${n}`, groupId }) as Merchant;

describe('MerchantGroupsService.create', () => {
  it('creates the group with a case-folded key and moves the merchants into it, with the audit in one transaction', async () => {
    const { service, manager, audit, updateBuilder } = build({
      merchants: [merchant(1)],
    });

    await service.create('  Casino Group ', [uuidOf(1)], ACTOR);

    expect(manager.create).toHaveBeenCalledWith(MerchantGroup, {
      name: 'Casino Group',
      nameKey: 'casino group',
    });
    expect(updateBuilder.set).toHaveBeenCalledWith({ groupId: 5 });
    expect(updateBuilder.andWhere).toHaveBeenCalledWith('"groupId" IS NULL');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR,
        action: 'merchant_group.created',
        metadata: {
          groupId: 5,
          name: 'Casino Group',
          merchantIds: [uuidOf(1)],
        },
      }),
      manager,
    );
  });

  it('answers 409 to a name another group holds in any case', async () => {
    const { service, manager } = build({
      nameClash: { id: 2 } as MerchantGroup,
      merchants: [merchant(1)],
    });

    await expect(
      service.create('ГРУППА', [uuidOf(1)], ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.findOne).toHaveBeenCalledWith(MerchantGroup, {
      where: { nameKey: 'группа' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('turns a unique violation raised under a race into the same 409', async () => {
    const { service, manager } = build({ merchants: [merchant(1)] });
    manager.save.mockRejectedValueOnce(
      new QueryFailedError('INSERT', [], { code: '23505' } as never),
    );

    await expect(
      service.create('Группа 2', [uuidOf(1)], ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 400 to an unknown merchant', async () => {
    const { service } = build({ merchants: [] });

    await expect(
      service.create('Группа', [uuidOf(1)], ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers 409 when a merchant is already in another group', async () => {
    const { service } = build({ merchants: [merchant(1, 3)], affected: 0 });

    await expect(
      service.create('Новая', [uuidOf(1)], ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MerchantGroupsService.update', () => {
  it('renames under the group lock and audits it', async () => {
    const { service, manager, audit } = build();

    await service.update(1, { name: 'Казино' }, ACTOR);

    expect(manager.findOne).toHaveBeenCalledWith(MerchantGroup, {
      where: { id: 1 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.update).toHaveBeenCalledWith(MerchantGroup, 1, {
      name: 'Казино',
      nameKey: 'казино',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'merchant_group.renamed' }),
      manager,
    );
  });

  it('lets a rename change only the case of the name without a clash check', async () => {
    const { service, manager } = build({
      nameClash: { id: 1 } as MerchantGroup,
    });

    await service.update(1, { name: 'ГРУППА' }, ACTOR);

    expect(manager.update).toHaveBeenCalledWith(MerchantGroup, 1, {
      name: 'ГРУППА',
      nameKey: 'группа',
    });
  });

  it('writes status and «Искл. залив» into every merchant of the group', async () => {
    const { service, manager, audit } = build({
      merchants: [merchant(1, 1), merchant(2, 1)],
    });

    await service.update(1, { active: false, exclusiveTopUp: true }, ACTOR);

    expect(manager.update).toHaveBeenCalledWith(
      Merchant,
      { groupId: 1 },
      { active: false, exclusiveTopUp: true },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merchant_group.flags_applied',
        metadata: {
          groupId: 1,
          active: false,
          exclusiveTopUp: true,
          merchantIds: [uuidOf(1), uuidOf(2)],
        },
      }),
      manager,
    );
  });

  it('answers 404 for an unknown group', async () => {
    const { service } = build({ group: null });

    await expect(
      service.update(1, { active: true }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MerchantGroupsService.addMerchants', () => {
  it('moves only merchants not yet in the group, conditionally on them having none', async () => {
    const { service, updateBuilder, audit, manager } = build({
      merchants: [merchant(1, 1), merchant(2)],
      affected: 1,
    });

    await service.addMerchants(1, [uuidOf(1), uuidOf(2)], ACTOR);

    expect(updateBuilder.where).toHaveBeenCalledWith('id IN (:...ids)', {
      ids: [uuidOf(2)],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merchant_group.merchants_added',
        metadata: { groupId: 1, merchantIds: [uuidOf(2)] },
      }),
      manager,
    );
  });

  it('answers 409 when a merchant sits in another group', async () => {
    const { service } = build({ merchants: [merchant(2, 7)], affected: 0 });

    await expect(
      service.addMerchants(1, [uuidOf(2)], ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 404 for an unknown group', async () => {
    const { service } = build({ group: null, merchants: [merchant(2)] });

    await expect(
      service.addMerchants(1, [uuidOf(2)], ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MerchantGroupsService.removeMerchant', () => {
  it('takes the merchant out and keeps a group that still has merchants', async () => {
    const { service, manager } = build({
      merchants: [merchant(1, 1)],
      left: 1,
    });

    const view = await service.removeMerchant(1, uuidOf(1), ACTOR);

    expect(manager.update).toHaveBeenCalledWith(Merchant, uuidOf(1), {
      groupId: null,
    });
    expect(manager.delete).not.toHaveBeenCalled();
    expect(view).not.toBeNull();
  });

  it('deletes a group left empty and answers null', async () => {
    const { service, manager, audit } = build({
      merchants: [merchant(1, 1)],
      left: 0,
    });

    const view = await service.removeMerchant(1, uuidOf(1), ACTOR);

    expect(manager.delete).toHaveBeenCalledWith(MerchantGroup, 1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'merchant_group.deleted' }),
      manager,
    );
    expect(view).toBeNull();
  });

  it('answers 404 for a merchant that is not in the group', async () => {
    const { service } = build({ merchants: [] });

    await expect(
      service.removeMerchant(1, uuidOf(1), ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MerchantGroupsService.moveWithin', () => {
  it('does nothing when the merchant is already where it is asked to be', async () => {
    const { service, manager } = build();

    await service.moveWithin(manager as never, merchant(1, 1), 1, ACTOR);

    expect(manager.update).not.toHaveBeenCalled();
  });

  it('takes a merchant out of its group and deletes the group when it empties', async () => {
    const { service, manager } = build({ left: 0 });

    await service.moveWithin(manager as never, merchant(1, 1), null, ACTOR);

    expect(manager.update).toHaveBeenCalledWith(Merchant, uuidOf(1), {
      groupId: null,
    });
    expect(manager.delete).toHaveBeenCalledWith(MerchantGroup, 1);
  });

  it('answers 409 when moving a merchant that already has another group', async () => {
    const { service, manager } = build({ affected: 0 });

    await expect(
      service.moveWithin(manager as never, merchant(1, 3), 1, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 400 for a group nobody holds', async () => {
    const { service, manager } = build({ group: null });

    await expect(
      service.moveWithin(manager as never, merchant(1), 8, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MerchantGroupsService.list', () => {
  it('pages the groups by name with an id tiebreak and counts members in one grouped query', async () => {
    const { service, groupsRepository } = build();

    const page = await service.list({
      page: 1,
      limit: 20,
      sortBy: MerchantGroupSortField.Name,
      sortOrder: SortOrder.Asc,
      search: 'gr_',
    });

    expect(groupsRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ order: { name: 'ASC', id: 'ASC' } }),
    );
    expect(page.items[0].merchantCount).toBe(3);
    expect(page.meta.total).toBe(1);
  });
});

describe('MerchantGroupsService.lockGroupsWithin', () => {
  it('locks each named group once, in ascending id order, skipping no group', async () => {
    const { service, manager } = build();

    await service.lockGroupsWithin(manager as never, [7, null, 3, 7]);

    expect(manager.findOne.mock.calls).toEqual([
      [
        MerchantGroup,
        { where: { id: 3 }, lock: { mode: 'pessimistic_write' } },
      ],
      [
        MerchantGroup,
        { where: { id: 7 }, lock: { mode: 'pessimistic_write' } },
      ],
    ]);
  });
});

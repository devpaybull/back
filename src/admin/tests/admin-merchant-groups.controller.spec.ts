import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { MerchantGroup } from '../../merchants/entities/merchant-group.entity';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { AdminMerchantGroupsController } from '../controllers/admin-merchant-groups.controller';
import { CreateMerchantGroupDto } from '../dto/create-merchant-group.dto';
import { UpdateMerchantGroupDto } from '../dto/update-merchant-group.dto';

const admin = { id: uuidOf(9), role: Role.Admin } as AuthenticatedUser;
const view = {
  group: { id: 1, name: 'Группа', createdAt: new Date(0) } as MerchantGroup,
  merchants: [
    { id: uuidOf(1), name: 'Casino', internalName: null } as Merchant,
  ],
};

const build = () => {
  const groups = {
    list: jest.fn(),
    create: jest.fn(async () => view),
    update: jest.fn(async () => view),
    addMerchants: jest.fn(async () => view),
    removeMerchant: jest.fn(async () => view),
  };

  return {
    groups,
    controller: new AdminMerchantGroupsController(groups as never),
  };
};

describe('AdminMerchantGroupsController', () => {
  it('is guarded for admin and superadmin, every mutation a write', () => {
    const { controller } = build();

    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminMerchantGroupsController),
    ).toEqual([Role.Admin, Role.Superadmin]);
    for (const handler of [
      controller.create,
      controller.update,
      controller.addMerchants,
      controller.removeMerchant,
    ]) {
      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
        true,
      );
    }
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.list),
    ).toBeUndefined();
  });

  it('creates a group as the admin and answers it with its merchants', async () => {
    const { controller, groups } = build();

    const result = await controller.create(
      { name: 'Группа', merchantIds: [uuidOf(1)] },
      admin,
    );

    expect(groups.create).toHaveBeenCalledWith('Группа', [uuidOf(1)], admin.id);
    expect(result).toEqual({
      id: 1,
      name: 'Группа',
      merchants: [{ id: uuidOf(1), name: 'Casino', internalName: null }],
      createdAt: new Date(0),
    });
  });

  it('refuses an empty edit and an id out of range with a 400', async () => {
    const { controller, groups } = build();

    await expect(controller.update(1, {}, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.update(0, { name: 'X' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.addMerchants(2147483648, { merchantIds: [uuidOf(1)] }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(groups.update).not.toHaveBeenCalled();
  });

  it('answers null when removing the last merchant deleted the group', async () => {
    const { controller, groups } = build();
    groups.removeMerchant.mockResolvedValue(null as never);

    await expect(
      controller.removeMerchant(1, uuidOf(1), admin),
    ).resolves.toBeNull();
  });

  it('validates the create body: a name and at least one merchant uuid', async () => {
    const errors = async (body: object) =>
      (await validate(plainToInstance(CreateMerchantGroupDto, body))).map(
        (error) => error.property,
      );

    expect(await errors({ name: '  ', merchantIds: [uuidOf(1)] })).toEqual([
      'name',
    ]);
    expect(await errors({ name: 'A', merchantIds: [] })).toEqual([
      'merchantIds',
    ]);
    expect(await errors({ name: 'A', merchantIds: ['nope'] })).toEqual([
      'merchantIds',
    ]);
    expect(await errors({ name: 'A', merchantIds: [uuidOf(1)] })).toEqual([]);
  });

  it('refuses null for a group flag', async () => {
    const result = await validate(
      plainToInstance(UpdateMerchantGroupDto, { active: null }),
    );

    expect(result.map((error) => error.property)).toEqual(['active']);
  });
});

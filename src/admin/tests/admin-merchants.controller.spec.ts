import { NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { MerchantApiKey } from '../../merchants/entities/merchant-api-key.entity';
import { AdminMerchantsController } from '../controllers/admin-merchants.controller';

describe('AdminMerchantsController', () => {
  let merchants: {
    list: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    createKey: jest.Mock;
  };
  let controller: AdminMerchantsController;

  beforeEach(() => {
    merchants = {
      list: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      createKey: jest.fn(),
    };
    controller = new AdminMerchantsController(merchants as never);
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminMerchantsController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks the two creations as writes and the list as a read', () => {
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.create),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.createKey),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.list),
    ).toBeUndefined();
  });

  it('creates a merchant', async () => {
    merchants.create.mockResolvedValue({
      id: uuidOf(1),
      name: 'Acme',
      active: true,
      createdAt: new Date(),
    } as Merchant);

    const result = await controller.create({ name: 'Acme' });

    expect(merchants.create).toHaveBeenCalledWith('Acme');
    expect(result.name).toBe('Acme');
  });

  it('404 when issuing a key for an unknown merchant', async () => {
    merchants.findById.mockResolvedValue(null);

    await expect(controller.createKey(uuidOf(1))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(merchants.createKey).not.toHaveBeenCalled();
  });

  it('issues a key for a known merchant', async () => {
    merchants.findById.mockResolvedValue({ id: uuidOf(1) } as Merchant);
    merchants.createKey.mockResolvedValue({
      id: 1,
      merchantId: uuidOf(1),
      key: 'k',
      secret: 's',
      active: true,
      revokedAt: null,
      createdAt: new Date(),
    } as MerchantApiKey);

    const result = await controller.createKey(uuidOf(1));

    expect(merchants.createKey).toHaveBeenCalledWith(uuidOf(1));
    expect(result.secret).toBe('s');
  });
});

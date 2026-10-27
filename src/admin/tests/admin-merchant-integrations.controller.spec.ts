import { NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { MerchantApiKey } from '../../merchants/entities/merchant-api-key.entity';
import { MerchantIpAddress } from '../../merchants/entities/merchant-ip-address.entity';
import { AdminMerchantIntegrationsController } from '../controllers/admin-merchant-integrations.controller';

const MERCHANT = uuidOf(3);
const admin = { id: uuidOf(9), role: Role.Admin } as AuthenticatedUser;
const superadmin = {
  id: uuidOf(8),
  role: Role.Superadmin,
} as AuthenticatedUser;
const CREATED = new Date('2026-10-26T10:00:00Z');

const key = {
  id: 5,
  merchantId: MERCHANT,
  key: 'k',
  secret: 's',
  active: true,
  revokedAt: null,
  createdAt: CREATED,
} as unknown as MerchantApiKey;

const build = (merchantExists = true) => {
  const merchants = {
    findById: jest.fn(async () => (merchantExists ? { id: MERCHANT } : null)),
    listKeys: jest.fn(async () => [key]),
    createKey: jest.fn(async () => key),
    revokeKey: jest.fn(async () => ({ ...key, active: false })),
  };
  const addresses = {
    list: jest.fn(
      async () =>
        [
          { id: 1, ip: '203.0.113.47', createdAt: CREATED },
          { id: 2, ip: '2001:db8:0:0:0:0:0:1', createdAt: CREATED },
        ] as MerchantIpAddress[],
    ),
    add: jest.fn(
      async () =>
        ({
          id: 3,
          ip: '198.51.100.7',
          createdAt: CREATED,
        }) as MerchantIpAddress,
    ),
    remove: jest.fn(async () => undefined),
  };

  return {
    merchants,
    addresses,
    controller: new AdminMerchantIntegrationsController(
      merchants as never,
      addresses as never,
    ),
  };
};

describe('AdminMerchantIntegrationsController', () => {
  const proto = AdminMerchantIntegrationsController.prototype;

  it('is open to admin and superadmin, with keys and removing an address for a superadmin only', () => {
    expect(
      Reflect.getMetadata(
        ROLES_METADATA_KEY,
        AdminMerchantIntegrationsController,
      ),
    ).toEqual([Role.Admin, Role.Superadmin]);
    for (const handler of [
      proto.keys,
      proto.createKey,
      proto.revokeKey,
      proto.removeIpAddress,
    ]) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toEqual([
        Role.Superadmin,
      ]);
    }
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, proto.ipAddresses),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, proto.addIpAddress),
    ).toBeUndefined();
  });

  it('marks every mutation as a write', () => {
    for (const handler of [
      proto.createKey,
      proto.revokeKey,
      proto.addIpAddress,
      proto.removeIpAddress,
    ]) {
      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
        true,
      );
    }
  });

  it('lists the keys without their secrets', async () => {
    const { controller } = build();

    expect(await controller.keys(MERCHANT)).toEqual([
      { id: 5, key: 'k', active: true, revokedAt: null, createdAt: CREATED },
    ]);
  });

  it('answers 404 for the keys of an unknown merchant', async () => {
    const { controller } = build(false);

    await expect(controller.keys(MERCHANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('shows the secret once, when the key is issued', async () => {
    const { controller, merchants } = build();

    const issued = await controller.createKey(MERCHANT, superadmin);

    expect(merchants.createKey).toHaveBeenCalledWith(MERCHANT, superadmin.id);
    expect(issued.secret).toBe('s');
  });

  it('revokes a key', async () => {
    const { controller, merchants } = build();

    const revoked = await controller.revokeKey(MERCHANT, 5, superadmin);

    expect(merchants.revokeKey).toHaveBeenCalledWith(
      MERCHANT,
      5,
      superadmin.id,
    );
    expect(revoked.active).toBe(false);
    expect('secret' in revoked).toBe(false);
  });

  it('masks the addresses for an admin', async () => {
    const { controller } = build();

    expect(await controller.ipAddresses(MERCHANT, admin)).toEqual([
      { id: 1, ip: '203.0.*.*', masked: true, createdAt: CREATED },
      { id: 2, ip: '2001:db8:0:0:*:*:*:*', masked: true, createdAt: CREATED },
    ]);
  });

  it('shows the full addresses to a superadmin', async () => {
    const { controller } = build();

    expect(
      (await controller.ipAddresses(MERCHANT, superadmin)).map((row) => row.ip),
    ).toEqual(['203.0.113.47', '2001:db8:0:0:0:0:0:1']);
  });

  it('lets an admin add an address and see it masked', async () => {
    const { controller, addresses } = build();

    const added = await controller.addIpAddress(
      MERCHANT,
      { ip: '198.51.100.7' },
      admin,
    );

    expect(addresses.add).toHaveBeenCalledWith(
      MERCHANT,
      '198.51.100.7',
      admin.id,
    );
    expect(added).toEqual({
      id: 3,
      ip: '198.51.*.*',
      masked: true,
      createdAt: CREATED,
    });
  });

  it('removes an address', async () => {
    const { controller, addresses } = build();

    await controller.removeIpAddress(MERCHANT, 1, superadmin);

    expect(addresses.remove).toHaveBeenCalledWith(MERCHANT, 1, superadmin.id);
  });

  it('answers 404 to an id beyond int4 before it reaches the database', async () => {
    const { controller, merchants, addresses } = build();

    await expect(
      controller.revokeKey(MERCHANT, 3000000000, superadmin),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.removeIpAddress(MERCHANT, 3000000000, superadmin),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(merchants.revokeKey).not.toHaveBeenCalled();
    expect(addresses.remove).not.toHaveBeenCalled();
  });
});

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantIpAddress } from '../entities/merchant-ip-address.entity';
import { MerchantSettings } from '../entities/merchant-settings.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantIpAddressesService } from '../services/merchant-ip-addresses.service';

const MERCHANT = uuidOf(3);
const ACTOR = uuidOf(9);

const address = (id: number, ip: string) =>
  ({ id, merchantId: MERCHANT, ip }) as MerchantIpAddress;

const build = (
  options: {
    existing?: MerchantIpAddress[];
    merchantExists?: boolean;
    ipCheckEnabled?: boolean;
  } = {},
) => {
  const existing = options.existing ?? [];
  const manager = {
    findOne: jest.fn(
      async (
        entity: unknown,
        query: { where: { id?: number } },
      ): Promise<unknown> => {
        if (entity === Merchant) {
          return options.merchantExists === false ? null : { id: MERCHANT };
        }
        if (entity === MerchantSettings) {
          return { ipCheckEnabled: options.ipCheckEnabled ?? false };
        }
        return existing.find((row) => row.id === query.where.id) ?? null;
      },
    ),
    find: jest.fn(async () => existing),
    count: jest.fn(async () => existing.length),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (row: object) => ({ id: 40, ...row })),
    delete: jest.fn(async () => undefined),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const repository = { find: jest.fn(async () => existing) };
  const audit = { record: jest.fn(async () => undefined) };

  return {
    manager,
    repository,
    audit,
    service: new MerchantIpAddressesService(
      repository as never,
      dataSource as never,
      audit as never,
    ),
  };
};

describe('MerchantIpAddressesService', () => {
  it('lists the whitelist oldest first', async () => {
    const { service, repository } = build();

    await service.list(MERCHANT);

    expect(repository.find).toHaveBeenCalledWith({
      where: { merchantId: MERCHANT },
      order: { id: 'ASC' },
    });
  });

  it('adds an address under the merchant lock with its audit row', async () => {
    const { service, manager, audit } = build();

    const saved = await service.add(MERCHANT, ' 203.0.113.47 ', ACTOR);

    expect(manager.findOne).toHaveBeenCalledWith(Merchant, {
      where: { id: MERCHANT },
      lock: { mode: 'pessimistic_write' },
    });
    expect(saved.ip).toBe('203.0.113.47');
    expect(saved.createdByUserId).toBe(ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorUserId: ACTOR,
        action: 'merchant.ip_added',
        metadata: { merchantId: MERCHANT, ipAddressId: 40, ip: '203.0.*.*' },
      },
      manager,
    );
  });

  it.each([
    ['2001:DB8::1', '2001:db8:0:0:0:0:0:1'],
    ['::1', '0:0:0:0:0:0:0:1'],
    ['2001:0db8:0000:0000:0000:ff00:0042:8329', '2001:db8:0:0:0:ff00:42:8329'],
    ['::ffff:192.0.2.128', '192.0.2.128'],
    ['::FFFF:c000:0280', '192.0.2.128'],
  ])('stores IPv6 %s in one written form, %s', async (raw, stored) => {
    const { service } = build();

    expect((await service.add(MERCHANT, raw, ACTOR)).ip).toBe(stored);
  });

  it('refuses something that is not an IP address with a 400', async () => {
    const { service, manager } = build();

    await expect(
      service.add(MERCHANT, '203.0.113.0/24', ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses an address with a zone with a 400', async () => {
    const { service, manager } = build();

    await expect(
      service.add(MERCHANT, 'fe80::1%eth0', ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses the same address twice with a 409 that does not echo it, whatever its written form', async () => {
    const { service } = build({
      existing: [address(1, '2001:db8:0:0:0:0:0:1')],
    });

    const error = await service
      .add(MERCHANT, '2001:db8::1', ACTOR)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).not.toContain('2001');
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 one', async () => {
    const { service } = build({ existing: [address(1, '192.0.2.128')] });

    await expect(
      service.add(MERCHANT, '::ffff:192.0.2.128', ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a 51st address with a 400, before telling whether it is already there', async () => {
    const { service } = build({
      existing: Array.from({ length: 50 }, (_, index) =>
        address(index + 1, `10.0.0.${index + 1}`),
      ),
    });

    await expect(
      service.add(MERCHANT, '10.0.1.1', ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.add(MERCHANT, '10.0.0.7', ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers 404 for an unknown merchant', async () => {
    const { service } = build({ merchantExists: false });

    await expect(
      service.add(MERCHANT, '10.0.0.1', ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes an address with its audit row', async () => {
    const { service, manager, audit } = build({
      existing: [address(1, '10.0.0.1')],
    });

    await service.remove(MERCHANT, 1, ACTOR);

    expect(manager.delete).toHaveBeenCalledWith(MerchantIpAddress, { id: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorUserId: ACTOR,
        action: 'merchant.ip_removed',
        metadata: { merchantId: MERCHANT, ipAddressId: 1, ip: '10.0.*.*' },
      },
      manager,
    );
  });

  it('answers 404 for an address of another merchant', async () => {
    const { service } = build();

    await expect(service.remove(MERCHANT, 1, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to remove the last address while IP checking is on', async () => {
    const { service, manager } = build({
      existing: [address(1, '10.0.0.1')],
      ipCheckEnabled: true,
    });

    await expect(service.remove(MERCHANT, 1, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('removes one of several addresses while IP checking is on', async () => {
    const { service, manager } = build({
      existing: [address(1, '10.0.0.1'), address(2, '10.0.0.2')],
      ipCheckEnabled: true,
    });

    await service.remove(MERCHANT, 1, ACTOR);

    expect(manager.delete).toHaveBeenCalled();
  });
});

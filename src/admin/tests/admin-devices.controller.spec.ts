import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/types/token';
import { UserStatus } from '../../users/types/user-status.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { DevicesService } from '../../devices/devices.service';
import { Device } from '../../devices/entities/device.entity';
import { DeviceStatus } from '../../devices/types/device-status.enum';
import { User } from '../../users/entities/user.entity';
import { AdminDevicesController } from '../controllers/admin-devices.controller';
import { ListDevicesQueryDto } from '../dto/list-devices-query.dto';

describe('AdminDevicesController', () => {
  const admin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'admin@example.com',
    role: Role.Admin,
    status: UserStatus.Active,
  };

  const owner = {
    id: uuidOf(1),
    email: 'trader@example.com',
    telegramUsername: null,
    role: Role.Trader,
  } as User;

  const device = (overrides: Partial<Device> = {}): Device =>
    ({
      id: 100,
      key: uuidOf(500),
      userId: uuidOf(1),
      user: owner,
      name: 'Pixel 7',
      status: DeviceStatus.Off,
      model: null,
      type: null,
      phone: null,
      lastActivity: null,
      createdAt: new Date(),
      ...overrides,
    }) as Device;

  const devices = { list: jest.fn(), findById: jest.fn() };
  const bankDetails = { deleteDevice: jest.fn() };

  const query = (
    overrides: Record<string, unknown> = {},
  ): ListDevicesQueryDto => plainToInstance(ListDevicesQueryDto, overrides);

  let controller: AdminDevicesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    devices.list.mockResolvedValue(
      toPage([[device()], 1], { page: 1, limit: 20 }),
    );
    devices.findById.mockResolvedValue(device());

    const module = await Test.createTestingModule({
      controllers: [AdminDevicesController],
      providers: [
        { provide: DevicesService, useValue: devices },
        { provide: BankDetailsService, useValue: bankDetails },
      ],
    }).compile();

    controller = module.get(AdminDevicesController);
  });

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminDevicesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks deleting as a write', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminDevicesController.prototype.remove,
      ),
    ).toBe(true);
  });

  it('leaves the list unmarked, so a suspended admin still reads', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminDevicesController.prototype.list,
      ),
    ).toBeUndefined();
  });

  it('lists across every account, carrying the owner of each row', async () => {
    const listed = await controller.list(query());

    expect(listed.items[0]).toMatchObject({
      userId: uuidOf(1),
      user: { id: uuidOf(1), login: 'trader@example.com', role: Role.Trader },
    });
  });

  it('passes the owner filter through untouched, unlike the trader’s own list', async () => {
    await controller.list(query({ userId: uuidOf(2) }));

    expect(devices.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: uuidOf(2) }),
    );
  });

  it('shows the key, which is an ordinary field rather than a secret', async () => {
    const listed = await controller.list(query());

    expect(listed.items[0]).toMatchObject({ key: uuidOf(500) });
  });

  it('deletes any account’s device, unbinding its requisites', async () => {
    await controller.remove(100, admin);

    expect(bankDetails.deleteDevice).toHaveBeenCalledWith(100, uuidOf(9));
  });

  it('answers 404 for an id nobody holds, and deletes nothing', async () => {
    devices.findById.mockResolvedValue(null);

    await expect(controller.remove(404, admin)).rejects.toThrow(
      NotFoundException,
    );
    expect(bankDetails.deleteDevice).not.toHaveBeenCalled();
  });

  it('does not scope the delete to an owner, which is what makes it the admin path', async () => {
    await controller.remove(100, admin);

    expect(devices.findById).toHaveBeenCalledWith(100);
  });
});

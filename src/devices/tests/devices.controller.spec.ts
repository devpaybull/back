import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { UserStatus } from '../../users/types/user-status.enum';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { DevicesController } from '../devices.controller';
import { DevicesService } from '../devices.service';
import { ListDevicesQueryDto } from '../dto/list-devices-query.dto';
import { Device } from '../entities/device.entity';
import { DeviceStatus } from '../types/device-status.enum';

describe('DevicesController', () => {
  const trader: AuthenticatedUser = {
    id: uuidOf(1),
    login: 'trader@example.com',
    role: Role.Trader,
    status: UserStatus.Active,
  };

  const device = (overrides: Partial<Device> = {}): Device =>
    ({
      id: 100,
      key: uuidOf(500),
      userId: uuidOf(1),
      name: 'Pixel 7',
      status: DeviceStatus.Off,
      model: null,
      type: null,
      phone: null,
      lastActivity: null,
      createdAt: new Date(),
      ...overrides,
    }) as Device;

  const devices = {
    create: jest.fn(),
    list: jest.fn(),
    findOwn: jest.fn(),
    updateOwn: jest.fn(),
    delete: jest.fn(),
  };

  const bankDetails = { deleteOwnDevice: jest.fn() };

  const query = (
    overrides: Record<string, unknown> = {},
  ): ListDevicesQueryDto => plainToInstance(ListDevicesQueryDto, overrides);

  let controller: DevicesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    devices.create.mockResolvedValue(device());
    devices.list.mockResolvedValue(
      toPage([[device()], 1], { page: 1, limit: 20 }),
    );
    devices.findOwn.mockResolvedValue(device());
    devices.updateOwn.mockResolvedValue(device({ name: 'Work phone' }));

    const module = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        { provide: DevicesService, useValue: devices },
        { provide: BankDetailsService, useValue: bankDetails },
      ],
    }).compile();

    controller = module.get(DevicesController);
  });

  it('is restricted to traders', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, DevicesController)).toEqual([
      Role.Trader,
    ]);
  });

  it.each(['create', 'update'])('marks %s as a write', (handler) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        DevicesController.prototype[handler],
      ),
    ).toBe(true);
  });

  it.each(['list', 'findOne'])(
    'leaves %s unmarked, so a suspended trader still reads',
    (handler) => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          DevicesController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );

  describe('the owner is taken from the token, never from the body', () => {
    it('registers the device against the signed-in trader', async () => {
      await controller.create({ name: 'Pixel 7' }, trader);

      expect(devices.create).toHaveBeenCalledWith({
        name: 'Pixel 7',
        userId: uuidOf(1),
      });
    });

    it('scopes the list to the signed-in trader', async () => {
      await controller.list(query(), trader);

      expect(devices.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(1) }),
      );
    });

    it('overrides a userId a caller tried to smuggle into the query', async () => {
      await controller.list(query({ userId: uuidOf(2) }), trader);

      expect(devices.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(1) }),
      );
    });

    it('reads one row only through the owner-scoped finder', async () => {
      await controller.findOne(100, trader);

      expect(devices.findOwn).toHaveBeenCalledWith(100, uuidOf(1));
    });

    it('patches one row only through the owner-scoped update', async () => {
      await controller.update(100, { name: 'Work phone' }, trader);

      expect(devices.updateOwn).toHaveBeenCalledWith(100, uuidOf(1), {
        name: 'Work phone',
      });
    });

    it('deletes one row only through the owner-scoped delete', async () => {
      await controller.remove(100, trader);

      expect(bankDetails.deleteOwnDevice).toHaveBeenCalledWith(100, uuidOf(1));
    });
  });

  it('marks deleting as a write', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        DevicesController.prototype.remove,
      ),
    ).toBe(true);
  });

  it('deletes through bank-details, because unbinding the requisites comes first', async () => {
    await controller.remove(100, trader);

    expect(devices.delete).not.toHaveBeenCalled();
  });

  it('answers 404 for a device the trader does not own', async () => {
    devices.findOwn.mockResolvedValue(null);

    await expect(controller.findOne(100, trader)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses an empty patch rather than saving nothing', async () => {
    await expect(controller.update(100, {}, trader)).rejects.toThrow(
      BadRequestException,
    );
    expect(devices.updateOwn).not.toHaveBeenCalled();
  });

  it('hands the owner the key, which is what the phone app registers against', async () => {
    await expect(controller.findOne(100, trader)).resolves.toMatchObject({
      key: uuidOf(500),
    });
  });

  it('reports a device the app has never checked in from as off and empty', async () => {
    await expect(controller.findOne(100, trader)).resolves.toMatchObject({
      status: DeviceStatus.Off,
      model: null,
      type: null,
      phone: null,
      lastActivity: null,
    });
  });
});

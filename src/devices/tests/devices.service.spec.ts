import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { DevicesService } from '../devices.service';
import { Device } from '../entities/device.entity';
import { DeviceSortField } from '../types/device-sort-field';
import { DeviceStatus } from '../types/device-status.enum';

describe('DevicesService', () => {
  const owner = uuidOf(1);
  const stranger = uuidOf(2);

  let stored: Device[];
  let service: DevicesService;

  const devices = {
    findOne: jest.fn(
      async ({ where }: { where: Partial<Device> }) =>
        stored.find((row) =>
          Object.entries(where).every(([field, value]) => row[field] === value),
        ) ?? null,
    ),
    findAndCount: jest.fn(async () => [stored, stored.length]),
    create: jest.fn((data: Partial<Device>) => ({ ...data }) as Device),
    merge: jest.fn((target: Device, patch: Partial<Device>) =>
      Object.assign(target, patch),
    ),
    softDelete: jest.fn(async (id: number) => {
      const row = stored.find((held) => held.id === id);

      if (row) row.deletedAt = new Date();

      return { affected: row ? 1 : 0 };
    }),
    save: jest.fn(async (row: Device) => {
      if (stored.includes(row)) return row;

      const saved = {
        ...row,
        id: row.id ?? stored.length + 100,
        key: row.key ?? uuidOf(stored.length + 500),
        status: row.status ?? DeviceStatus.Off,
      };
      stored.push(saved);

      return saved;
    }),
  };

  const device = (overrides: Partial<Device> = {}): Device =>
    ({
      id: 100,
      key: uuidOf(500),
      userId: owner,
      name: 'Pixel 7',
      status: DeviceStatus.Off,
      model: null,
      type: null,
      phone: null,
      lastActivity: null,
      createdAt: new Date(),
      ...overrides,
    }) as Device;

  beforeEach(async () => {
    jest.clearAllMocks();
    stored = [device()];

    const module = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: getRepositoryToken(Device), useValue: devices },
      ],
    }).compile();

    service = module.get(DevicesService);
  });

  describe('create', () => {
    it('takes the name and nothing else from the caller', async () => {
      await service.create({ userId: owner, name: 'Redmi Note' });

      expect(devices.create).toHaveBeenCalledWith({
        userId: owner,
        name: 'Redmi Note',
      });
    });

    it('writes none of the fields the phone app owns', async () => {
      await service.create({ userId: owner, name: 'Redmi Note' });

      const [data] = devices.create.mock.calls[0] as [Partial<Device>];

      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('model');
      expect(data).not.toHaveProperty('type');
      expect(data).not.toHaveProperty('phone');
      expect(data).not.toHaveProperty('lastActivity');
    });

    it('leaves the key to the database rather than inventing one', async () => {
      await service.create({ userId: owner, name: 'Redmi Note' });

      const [data] = devices.create.mock.calls[0] as [Partial<Device>];

      expect(data).not.toHaveProperty('key');
    });

    it('stores the device against the owner it was told', async () => {
      await service.create({ userId: stranger, name: 'Redmi Note' });

      expect(devices.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: stranger }),
      );
    });
  });

  describe('findOwn', () => {
    it('finds the row when the owner asks', async () => {
      await expect(service.findOwn(100, owner)).resolves.toMatchObject({
        id: 100,
      });
    });

    it('answers nothing when somebody else asks for the same id', async () => {
      await expect(service.findOwn(100, stranger)).resolves.toBeNull();
    });
  });

  describe('list', () => {
    it('pages the query and orders by what was asked', async () => {
      await service.list({
        page: 2,
        limit: 10,
        sortBy: DeviceSortField.LastActivity,
        sortOrder: SortOrder.Asc,
        userId: owner,
      });

      expect(devices.findAndCount).toHaveBeenCalledWith({
        where: { userId: owner },
        order: { lastActivity: 'ASC', id: 'ASC' },
        relations: { user: true },
        skip: 10,
        take: 10,
      });
    });

    it('filters by the status the phone app reported', async () => {
      await service.list({
        page: 1,
        limit: 20,
        sortBy: DeviceSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
        userId: owner,
        status: DeviceStatus.On,
      });

      expect(devices.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: owner, status: DeviceStatus.On },
        }),
      );
    });
  });

  describe('updateOwn', () => {
    it('answers 404 when the row belongs to somebody else', async () => {
      await expect(
        service.updateOwn(100, stranger, { name: 'Stolen' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('renames a device the caller owns', async () => {
      await expect(
        service.updateOwn(100, owner, { name: 'Work phone' }),
      ).resolves.toMatchObject({ name: 'Work phone' });
    });
  });
});

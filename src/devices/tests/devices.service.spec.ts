import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { ActivityAction } from '../../audit/types/activity-action.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { DevicesService } from '../devices.service';
import { Device } from '../entities/device.entity';
import { DeviceModel } from '../types/device-model.enum';
import { DeviceSortField } from '../types/device-sort-field';
import { DeviceStatus } from '../types/device-status.enum';

describe('DevicesService', () => {
  const owner = uuidOf(1);
  const stranger = uuidOf(2);

  let stored: Device[];
  let service: DevicesService;

  const manager = {
    getRepository: jest.fn(() => devices),
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) => {
      const snapshot = stored.map((row) => ({ ...row }));

      try {
        return await work(manager);
      } catch (error) {
        stored = snapshot;
        throw error;
      }
    }),
  };

  const audit = {
    record: jest.fn<Promise<undefined>, [Record<string, unknown>, unknown?]>(
      async () => undefined,
    ),
  };

  const devices = {
    manager,
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
    stored = [device({ model: DeviceModel.Android })];
    audit.record.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: getRepositoryToken(Device), useValue: devices },
        { provide: AuditService, useValue: audit },
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

  describe('the activity feed', () => {
    it('writes a device_added row for the owner when a device is registered', async () => {
      const created = await service.create({ userId: owner, name: 'Redmi' });

      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: owner,
          impersonatorUserId: null,
          targetUserId: owner,
          action: ActivityAction.DeviceAdded,
          metadata: { id: created.id, name: 'Redmi', model: null },
        },
        manager,
      );
    });

    it('names the superadmin of a login-link session beside the trader on create and delete', async () => {
      await service.create({ userId: owner, name: 'Redmi' }, uuidOf(5));
      await service.delete(100, owner, manager as never, uuidOf(5));

      expect(
        audit.record.mock.calls.map(([entry]) => [
          entry.action,
          entry.actorUserId,
          entry.impersonatorUserId,
        ]),
      ).toEqual([
        [ActivityAction.DeviceAdded, owner, uuidOf(5)],
        [ActivityAction.DeviceDeleted, owner, uuidOf(5)],
      ]);
    });

    it('rolls the device back when the audit row cannot be written', async () => {
      audit.record.mockRejectedValue(new Error('audit down'));

      await expect(
        service.create({ userId: owner, name: 'Redmi' }),
      ).rejects.toThrow('audit down');
      expect(stored).toHaveLength(1);
    });

    it('writes a device_deleted row with the actor, the owner and the details', async () => {
      await service.delete(100, stranger, manager as never);

      expect(devices.softDelete).toHaveBeenCalledWith(100);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: stranger,
          impersonatorUserId: null,
          targetUserId: owner,
          action: ActivityAction.DeviceDeleted,
          metadata: { id: 100, name: 'Pixel 7', model: DeviceModel.Android },
        },
        manager,
      );
    });

    it('answers 404 and writes nothing for a device nobody holds', async () => {
      await expect(
        service.delete(404, owner, manager as never),
      ).rejects.toThrow(NotFoundException);
      expect(devices.softDelete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsRelations, Repository } from 'typeorm';
import { AuditService } from '../audit/services/audit.service';
import { ActivityAction } from '../audit/types/activity-action.enum';
import { Page, toPage } from '../common/types/page';
import { Device } from './entities/device.entity';
import { CreateDeviceInput } from './types/create-device-input';
import { DeviceListQuery } from './types/device-list-query';
import { OwnDeviceChanges } from './types/own-device-changes';
import { deviceActivityMetadata } from './utils/device-activity-metadata';
import { deviceListOrder } from './utils/device-list-order';
import { deviceListWhere } from './utils/device-list-where';

const RELATIONS: FindOptionsRelations<Device> = { user: true };

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: CreateDeviceInput,
    impersonatorUserId?: string | null,
  ): Promise<Device> {
    return this.devices.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Device);
      const created = await repository.save(
        repository.create({ userId: input.userId, name: input.name }),
      );
      const device = await repository.findOne({
        where: { id: created.id },
        relations: RELATIONS,
      });

      await this.audit.record(
        {
          actorUserId: input.userId,
          impersonatorUserId: impersonatorUserId ?? null,
          targetUserId: input.userId,
          action: ActivityAction.DeviceAdded,
          metadata: deviceActivityMetadata(device),
        },
        manager,
      );

      return device;
    });
  }

  async list(query: DeviceListQuery): Promise<Page<Device>> {
    return toPage(
      await this.devices.findAndCount({
        where: deviceListWhere(query),
        order: deviceListOrder(query),
        relations: RELATIONS,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async findById(id: number): Promise<Device> {
    return this.devices.findOne({ where: { id }, relations: RELATIONS });
  }

  async findOwn(id: number, userId: string): Promise<Device> {
    return this.devices.findOne({
      where: { id, userId },
      relations: RELATIONS,
    });
  }

  async updateOwn(
    id: number,
    userId: string,
    changes: OwnDeviceChanges,
  ): Promise<Device> {
    const owned = await this.findOwn(id, userId);

    if (!owned) throw new NotFoundException('Device not found');

    await this.devices.save(this.devices.merge(owned, changes));

    return this.findById(id);
  }

  async delete(
    id: number,
    actorUserId: string,
    manager: EntityManager,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    const repository = manager.getRepository(Device);
    const device = await repository.findOne({ where: { id } });

    if (!device) throw new NotFoundException('Device not found');

    await repository.softDelete(id);

    await this.audit.record(
      {
        actorUserId,
        impersonatorUserId: impersonatorUserId ?? null,
        targetUserId: device.userId,
        action: ActivityAction.DeviceDeleted,
        metadata: deviceActivityMetadata(device),
      },
      manager,
    );
  }
}

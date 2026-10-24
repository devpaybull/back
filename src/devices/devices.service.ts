import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, Repository } from 'typeorm';
import { Page, toPage } from '../common/types/page';
import { Device } from './entities/device.entity';
import { CreateDeviceInput } from './types/create-device-input';
import { DeviceListQuery } from './types/device-list-query';
import { OwnDeviceChanges } from './types/own-device-changes';
import { deviceListOrder } from './utils/device-list-order';
import { deviceListWhere } from './utils/device-list-where';

const RELATIONS: FindOptionsRelations<Device> = { user: true };

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
  ) {}

  async create(input: CreateDeviceInput): Promise<Device> {
    const created = await this.devices.save(
      this.devices.create({ userId: input.userId, name: input.name }),
    );

    return this.findById(created.id);
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

  async delete(id: number): Promise<void> {
    await this.devices.softDelete(id);
  }
}

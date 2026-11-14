import {
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import {
  EntityManager,
  FindOptionsRelations,
  ILike,
  In,
  IsNull,
  MoreThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditService } from '../audit/services/audit.service';
import { ActivityAction } from '../audit/types/activity-action.enum';
import { Page, toPage } from '../common/types/page';
import { escapeLikePattern } from '../common/utils/escape-like-pattern';
import { sha256Hex } from '../common/utils/sha256-hex';
import { DeviceCredential } from './entities/device-credential.entity';
import { DevicePairing } from './entities/device-pairing.entity';
import { Device } from './entities/device.entity';
import { CreateDeviceInput } from './types/create-device-input';
import { DeviceCounts } from './types/device-counts';
import { DeviceListQuery } from './types/device-list-query';
import { DevicePairingPayload } from './types/device-pairing-payload';
import { IssuedDevicePairing } from './types/issued-device-pairing';
import { OwnDeviceChanges } from './types/own-device-changes';
import { PairDeviceInput } from './types/pair-device-input';
import { PairedDevice } from './types/paired-device';
import { deviceActivityMetadata } from './utils/device-activity-metadata';
import { deviceListOrder } from './utils/device-list-order';
import { deviceListWhere } from './utils/device-list-where';

const RELATIONS: FindOptionsRelations<Device> = { user: true };
const SECOND_IN_MS = 1000;
const MINUTE_IN_MS = 60 * SECOND_IN_MS;
const TOKEN_BYTES = 32;
const PAIRING_REJECTED = 'Pairing token is invalid';
const PAIRING_GONE = 'Pairing token was already used or has expired';
const PAIRING_ISSUED_ACTION = 'device.pairing_issued';
const DEVICE_PAIRED_ACTION = 'device.paired';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
    @InjectRepository(DevicePairing)
    private readonly pairings: Repository<DevicePairing>,
    @InjectRepository(DeviceCredential)
    private readonly credentials: Repository<DeviceCredential>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  get heartbeatSeconds(): number {
    return this.config.get<number>('DEVICE_HEARTBEAT_SECONDS');
  }

  onlineSince(now: Date = new Date()): Date {
    return new Date(
      now.getTime() -
        this.config.get<number>('DEVICE_ONLINE_WINDOW_SECONDS') * SECOND_IN_MS,
    );
  }

  async create(
    input: CreateDeviceInput,
    impersonatorUserId?: string | null,
  ): Promise<Device> {
    return this.devices.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Device);
      const created = await repository.save(
        repository.create({
          userId: input.userId,
          name: input.name,
          ...(input.type ? { type: input.type } : {}),
        }),
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

  async countsOf(
    userId: string,
    now: Date = new Date(),
  ): Promise<DeviceCounts> {
    const [total, online] = await Promise.all([
      this.devices.count({ where: { userId } }),
      this.devices.count({
        where: { userId, lastActivity: MoreThanOrEqual(this.onlineSince(now)) },
      }),
    ]);

    return { total, online, offline: total - online };
  }

  async onlineDeviceIds(
    ids: readonly number[],
    now: Date = new Date(),
  ): Promise<number[]> {
    if (ids.length === 0) return [];

    const rows = await this.devices.find({
      select: { id: true },
      where: {
        id: In([...ids]),
        lastActivity: MoreThanOrEqual(this.onlineSince(now)),
      },
    });

    return rows.map((row) => row.id);
  }

  async findById(id: number): Promise<Device> {
    return this.devices.findOne({ where: { id }, relations: RELATIONS });
  }

  async findByIdsWithDeleted(ids: number[]): Promise<Device[]> {
    if (ids.length === 0) return [];

    return this.devices.find({ where: { id: In(ids) }, withDeleted: true });
  }

  async idsWithNameContaining(fragment: string): Promise<number[]> {
    const rows = await this.devices.find({
      select: { id: true },
      where: { name: ILike(`%${escapeLikePattern(fragment)}%`) },
      withDeleted: true,
    });

    return rows.map((row) => row.id);
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

  async issuePairing(
    id: number,
    userId: string,
    impersonatorUserId?: string | null,
  ): Promise<IssuedDevicePairing> {
    const device = await this.findOwn(id, userId);

    if (!device) throw new NotFoundException('Device not found');

    const pairingToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(
      Date.now() +
        this.config.get<number>('DEVICE_PAIRING_TTL_MINUTES') * MINUTE_IN_MS,
    );

    await this.devices.manager.transaction(async (manager) => {
      const repository = manager.getRepository(DevicePairing);

      await repository.delete({ deviceId: id, usedAt: IsNull() });

      const pairing = await repository.save(
        repository.create({
          deviceId: id,
          tokenHash: sha256Hex(pairingToken),
          expiresAt,
          usedAt: null,
        }),
      );

      await this.audit.record(
        {
          actorUserId: userId,
          impersonatorUserId: impersonatorUserId ?? null,
          targetUserId: device.userId,
          action: PAIRING_ISSUED_ACTION,
          metadata: {
            deviceId: id,
            pairingId: pairing.id,
            expiresAt: expiresAt.toISOString(),
          },
        },
        manager,
      );
    });

    const payload: DevicePairingPayload = {
      deviceKey: device.key,
      pairingToken,
    };

    return { qrPayload: JSON.stringify(payload), expiresAt };
  }

  async pair(input: PairDeviceInput): Promise<PairedDevice> {
    const pairing = await this.pairings.findOne({
      where: { tokenHash: sha256Hex(input.pairingToken) },
      relations: { device: true },
    });

    if (!pairing || !pairing.device) {
      throw new UnauthorizedException(PAIRING_REJECTED);
    }

    const now = new Date();

    if (pairing.usedAt || pairing.expiresAt <= now) {
      throw new GoneException(PAIRING_GONE);
    }

    const deviceToken = randomBytes(TOKEN_BYTES).toString('base64url');

    await this.devices.manager.transaction(async (manager) => {
      const { affected } = await manager
        .getRepository(DevicePairing)
        .update(
          { id: pairing.id, usedAt: IsNull(), expiresAt: MoreThan(now) },
          { usedAt: now },
        );

      if (affected !== 1) throw new GoneException(PAIRING_GONE);

      const credentials = manager.getRepository(DeviceCredential);

      await credentials.update(
        { deviceId: pairing.deviceId, revokedAt: IsNull() },
        { revokedAt: now },
      );
      await credentials.save(
        credentials.create({
          deviceId: pairing.deviceId,
          tokenHash: sha256Hex(deviceToken),
          revokedAt: null,
        }),
      );
      await manager.getRepository(Device).update(
        { id: pairing.deviceId },
        {
          activatedAt: now,
          lastActivity: now,
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.appVersion !== undefined
            ? { appVersion: input.appVersion }
            : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
        },
      );

      await this.audit.record(
        {
          actorUserId: pairing.device.userId,
          targetUserId: pairing.device.userId,
          action: DEVICE_PAIRED_ACTION,
          metadata: { deviceId: pairing.deviceId, pairingId: pairing.id },
        },
        manager,
      );
    });

    return { deviceToken, heartbeatSeconds: this.heartbeatSeconds };
  }

  async authenticate(deviceToken: string): Promise<Device | null> {
    const credential = await this.credentials.findOne({
      where: { tokenHash: sha256Hex(deviceToken), revokedAt: IsNull() },
      relations: { device: true },
    });

    return credential?.device ?? null;
  }

  async heartbeat(deviceId: number, appVersion?: string): Promise<void> {
    await this.devices.update(
      { id: deviceId },
      {
        lastActivity: new Date(),
        ...(appVersion !== undefined ? { appVersion } : {}),
      },
    );
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

    await manager
      .getRepository(DeviceCredential)
      .update({ deviceId: id, revokedAt: IsNull() }, { revokedAt: new Date() });
    await manager
      .getRepository(DevicePairing)
      .delete({ deviceId: id, usedAt: IsNull() });
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

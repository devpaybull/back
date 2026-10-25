import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, In, Repository } from 'typeorm';
import { AuditService } from '../audit/services/audit.service';
import { ActivityAction } from '../audit/types/activity-action.enum';
import { BanksService } from '../banks/banks.service';
import { Fiat } from '../common/types/fiat';
import { Page, toPage } from '../common/types/page';
import { sortDirection } from '../common/utils/sort-direction';
import { toFiat } from '../common/utils/to-fiat';
import { DevicesService } from '../devices/devices.service';
import { BankDetails } from './entities/bank-details.entity';
import { BankDetailsListQuery } from './types/bank-details-list-query';
import { BankDetailsSupervision } from './types/bank-details-supervision';
import { CreateBankDetailsInput } from './types/create-bank-details-input';
import { OwnBankDetailsChanges } from './types/own-bank-details-changes';
import { bankDetailsActivityMetadata } from './utils/bank-details-activity-metadata';
import { bankDetailsListOrder } from './utils/bank-details-list-order';
import { bankDetailsListWhere } from './utils/bank-details-list-where';
import { toggledLimits } from './utils/toggled-limits';

const RELATIONS: FindOptionsRelations<BankDetails> = {
  bank: { country: true, currency: true },
  device: true,
  user: true,
  bannedBy: true,
};

@Injectable()
export class BankDetailsService {
  constructor(
    @InjectRepository(BankDetails)
    private readonly bankDetails: Repository<BankDetails>,
    private readonly banks: BanksService,
    private readonly devices: DevicesService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  get counterpartyMinAmount(): Fiat {
    return toFiat(this.config.get<string>('COUNTERPARTY_MIN_AMOUNT'));
  }

  async create(
    input: CreateBankDetailsInput,
    impersonatorUserId?: string | null,
  ): Promise<BankDetails> {
    await this.assertBankExists(input.bankId);
    this.assertMinAmountNotForced(Boolean(input.counterpartyOnly), input);

    if (input.deviceId !== undefined) {
      await this.assertDeviceIsOwnedBy(input.deviceId, input.userId);
    }

    return this.bankDetails.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BankDetails);
      const created = await repository.save(
        repository.create({
          userId: input.userId,
          bankId: input.bankId,
          deviceId: input.deviceId ?? null,
          type: input.type,
          cardholderName: input.cardholderName ?? null,
          card: input.card ?? null,
          phone: input.phone ?? null,
          ...toggledLimits({}, input),
          counterpartyOnly: input.counterpartyOnly ?? false,
          reserve: input.reserve ?? false,
          ...(input.active !== undefined ? { active: input.active } : {}),
        }),
      );
      const details = await repository.findOne({
        where: { id: created.id },
        relations: RELATIONS,
      });

      await this.audit.record(
        {
          actorUserId: input.userId,
          impersonatorUserId: impersonatorUserId ?? null,
          targetUserId: input.userId,
          action: ActivityAction.BankDetailsAdded,
          metadata: bankDetailsActivityMetadata(details),
        },
        manager,
      );

      return details;
    });
  }

  async list(query: BankDetailsListQuery): Promise<Page<BankDetails>> {
    return toPage(
      await this.bankDetails.findAndCount({
        where: bankDetailsListWhere(query),
        order: bankDetailsListOrder(query),
        relations: RELATIONS,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async listIds(query: BankDetailsListQuery): Promise<string[]> {
    const rows = await this.bankDetails.find({
      select: { id: true },
      where: bankDetailsListWhere(query),
      order: { id: sortDirection(query.sortOrder) },
    });

    return rows.map((row) => row.id);
  }

  async findByIdsInOrder(ids: string[]): Promise<BankDetails[]> {
    if (ids.length === 0) return [];

    const rows = new Map(
      (
        await this.bankDetails.find({
          where: { id: In(ids) },
          relations: RELATIONS,
        })
      ).map((row) => [row.id, row]),
    );

    return ids.flatMap((id) => (rows.has(id) ? [rows.get(id)] : []));
  }

  async findIdsOfBank(bankId: number): Promise<string[]> {
    const rows = await this.bankDetails.find({
      select: { id: true },
      where: { bankId },
      withDeleted: true,
    });

    return rows.map((row) => row.id);
  }

  async findByIdsWithDeleted(ids: string[]): Promise<BankDetails[]> {
    if (ids.length === 0) return [];

    return this.bankDetails.find({
      where: { id: In(ids) },
      relations: { bank: true },
      withDeleted: true,
    });
  }

  async findById(id: string): Promise<BankDetails> {
    return this.bankDetails.findOne({ where: { id }, relations: RELATIONS });
  }

  async findOwn(id: string, userId: string): Promise<BankDetails> {
    return this.bankDetails.findOne({
      where: { id, userId },
      relations: RELATIONS,
    });
  }

  async updateOwn(
    id: string,
    userId: string,
    changes: OwnBankDetailsChanges,
  ): Promise<BankDetails> {
    const owned = await this.findOwn(id, userId);

    if (!owned) throw new NotFoundException('Bank details not found');

    if (changes.active === true && owned.bannedAt) {
      throw new ConflictException(
        'These bank details are banned and cannot be activated',
      );
    }

    if (changes.bankId !== undefined) {
      await this.assertBankExists(changes.bankId);
    }

    if (changes.deviceId !== undefined) {
      await this.assertDeviceIsOwnedBy(changes.deviceId, userId);
    }

    this.assertMinAmountNotForced(
      changes.counterpartyOnly ?? owned.counterpartyOnly,
      changes,
    );

    await this.bankDetails.save(
      this.bankDetails.merge(owned, {
        ...changes,
        ...toggledLimits(owned, changes),
      }),
    );

    return this.findById(id);
  }

  async supervise(
    id: string,
    supervision: BankDetailsSupervision,
    adminId: string,
  ): Promise<BankDetails> {
    const found = await this.findById(id);

    if (!found) throw new NotFoundException('Bank details not found');

    const banning =
      supervision.banned === undefined
        ? {}
        : supervision.banned
          ? { bannedAt: new Date(), bannedByUserId: adminId }
          : { bannedAt: null, bannedByUserId: null };

    await this.bankDetails.save(
      this.bankDetails.merge(found, {
        ...(supervision.active !== undefined
          ? { active: supervision.active }
          : {}),
        ...banning,
      }),
    );

    return this.findById(id);
  }

  async deleteOwn(
    id: string,
    userId: string,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    const owned = await this.findOwn(id, userId);

    if (!owned) throw new NotFoundException('Bank details not found');

    await this.softDelete(owned, userId, impersonatorUserId);
  }

  async delete(id: string, actorUserId: string): Promise<void> {
    const found = await this.findById(id);

    if (!found) throw new NotFoundException('Bank details not found');

    await this.softDelete(found, actorUserId);
  }

  async deleteDevice(
    deviceId: number,
    actorUserId: string,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    await this.bankDetails.manager.transaction(async (manager) => {
      await manager
        .getRepository(BankDetails)
        .update({ deviceId }, { deviceId: null });
      await this.devices.delete(
        deviceId,
        actorUserId,
        manager,
        impersonatorUserId ?? null,
      );
    });
  }

  async deleteOwnDevice(
    deviceId: number,
    userId: string,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    if (!(await this.devices.findOwn(deviceId, userId))) {
      throw new NotFoundException('Device not found');
    }

    await this.deleteDevice(deviceId, userId, impersonatorUserId);
  }

  private async softDelete(
    details: BankDetails,
    actorUserId: string,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    await this.bankDetails.manager.transaction(async (manager) => {
      await manager.getRepository(BankDetails).softDelete(details.id);

      await this.audit.record(
        {
          actorUserId,
          impersonatorUserId: impersonatorUserId ?? null,
          targetUserId: details.userId,
          action: ActivityAction.BankDetailsDeleted,
          metadata: bankDetailsActivityMetadata(details),
        },
        manager,
      );
    });
  }

  private async assertBankExists(bankId: number): Promise<void> {
    if (!(await this.banks.findById(bankId))) {
      throw new BadRequestException(`Bank ${bankId} does not exist`);
    }
  }

  private async assertDeviceIsOwnedBy(
    deviceId: number,
    userId: string,
  ): Promise<void> {
    if (!(await this.devices.findOwn(deviceId, userId))) {
      throw new BadRequestException(`Device ${deviceId} does not exist`);
    }
  }

  private assertMinAmountNotForced(
    counterpartyOnly: boolean,
    changes: OwnBankDetailsChanges,
  ): void {
    if (!counterpartyOnly) return;

    if (
      changes.minAmountEnabled !== undefined ||
      changes.minAmount !== undefined
    ) {
      throw new ConflictException(
        'A counterparty-only requisite has a fixed minimum amount that cannot be set here',
      );
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, Repository } from 'typeorm';
import { BanksService } from '../banks/banks.service';
import { Page, toPage } from '../common/types/page';
import { DevicesService } from '../devices/devices.service';
import { BankDetails } from './entities/bank-details.entity';
import { BankDetailsListQuery } from './types/bank-details-list-query';
import { BankDetailsSupervision } from './types/bank-details-supervision';
import { CreateBankDetailsInput } from './types/create-bank-details-input';
import { OwnBankDetailsChanges } from './types/own-bank-details-changes';
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
  ) {}

  get counterpartyMinAmount(): number {
    return this.config.get<number>('COUNTERPARTY_MIN_AMOUNT');
  }

  async create(input: CreateBankDetailsInput): Promise<BankDetails> {
    await this.assertBankExists(input.bankId);
    this.assertMinAmountNotForced(Boolean(input.counterpartyOnly), input);

    if (input.deviceId !== undefined) {
      await this.assertDeviceIsOwnedBy(input.deviceId, input.userId);
    }

    const created = await this.bankDetails.save(
      this.bankDetails.create({
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

    return this.findById(created.id);
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

  async deleteOwn(id: string, userId: string): Promise<void> {
    if (!(await this.findOwn(id, userId))) {
      throw new NotFoundException('Bank details not found');
    }

    await this.bankDetails.softDelete(id);
  }

  async delete(id: string): Promise<void> {
    if (!(await this.findById(id))) {
      throw new NotFoundException('Bank details not found');
    }

    await this.bankDetails.softDelete(id);
  }

  async deleteDevice(deviceId: number): Promise<void> {
    await this.bankDetails.update({ deviceId }, { deviceId: null });
    await this.devices.delete(deviceId);
  }

  async deleteOwnDevice(deviceId: number, userId: string): Promise<void> {
    if (!(await this.devices.findOwn(deviceId, userId))) {
      throw new NotFoundException('Device not found');
    }

    await this.deleteDevice(deviceId);
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

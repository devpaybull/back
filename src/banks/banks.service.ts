import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, In, Repository } from 'typeorm';
import { Page, toPage } from '../common/types/page';
import { CountriesService } from '../countries/countries.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { Bank } from './entities/bank.entity';
import { BankChanges } from './types/bank-changes';
import { BankListQuery } from './types/bank-list-query';
import { CreateBankInput } from './types/create-bank-input';
import { bankListOrder } from './utils/bank-list-order';
import { bankListWhere } from './utils/bank-list-where';

const RELATIONS: FindOptionsRelations<Bank> = {
  country: true,
  currency: { country: true },
  crossBorderCurrency: { country: true },
};

@Injectable()
export class BanksService {
  constructor(
    @InjectRepository(Bank)
    private readonly banks: Repository<Bank>,
    private readonly countries: CountriesService,
    private readonly currencies: CurrenciesService,
  ) {}

  async create(input: CreateBankInput): Promise<Bank> {
    await this.assertBankIdIsFree(input.bankId);

    if (input.code !== undefined) await this.assertCodeIsFree(input.code);

    await this.assertReferencesExist(input);

    const bank = await this.banks.save(
      this.banks.create({
        bankId: input.bankId,
        name: input.name,
        code: input.code ?? null,
        countryId: input.countryId,
        transactionTypes: input.transactionTypes,
        currencyId: input.currencyId,
        crossBorderCurrencyId: input.crossBorderCurrencyId ?? null,
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.automatic !== undefined
          ? { automatic: input.automatic }
          : {}),
      }),
    );

    return this.findById(bank.id);
  }

  async list(query: BankListQuery): Promise<Page<Bank>> {
    return toPage(
      await this.banks.findAndCount({
        where: bankListWhere(query),
        order: bankListOrder(query),
        relations: RELATIONS,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async findById(id: number): Promise<Bank> {
    return this.banks.findOne({ where: { id }, relations: RELATIONS });
  }

  async findByIds(ids: number[]): Promise<Bank[]> {
    if (ids.length === 0) return [];

    return this.banks.find({ where: { id: In(ids) } });
  }

  async update(id: number, changes: BankChanges): Promise<Bank> {
    const bank = await this.findById(id);

    if (!bank) throw new NotFoundException('Bank not found');

    if (changes.bankId !== undefined) {
      await this.assertBankIdIsFree(changes.bankId, id);
    }

    if (changes.code !== undefined) {
      await this.assertCodeIsFree(changes.code, id);
    }

    await this.assertReferencesExist(changes);

    await this.banks.save(this.banks.merge(bank, changes));

    return this.findById(id);
  }

  private async assertBankIdIsFree(
    bankId: string,
    ownedBy?: number,
  ): Promise<void> {
    const holder = await this.banks.findOne({ where: { bankId } });

    if (holder && holder.id !== ownedBy) {
      throw new ConflictException(`The bank ${bankId} already exists`);
    }
  }

  private async assertCodeIsFree(
    code: string,
    ownedBy?: number,
  ): Promise<void> {
    const holder = await this.banks.findOne({ where: { code } });

    if (holder && holder.id !== ownedBy) {
      throw new ConflictException(`The bank code ${code} is already taken`);
    }
  }

  private async assertReferencesExist(changes: BankChanges): Promise<void> {
    if (
      changes.countryId !== undefined &&
      !(await this.countries.findById(changes.countryId))
    ) {
      throw new BadRequestException(
        `Country ${changes.countryId} does not exist`,
      );
    }

    if (
      changes.currencyId !== undefined &&
      !(await this.currencies.findById(changes.currencyId))
    ) {
      throw new BadRequestException(
        `Currency ${changes.currencyId} does not exist`,
      );
    }

    if (
      changes.crossBorderCurrencyId !== undefined &&
      !(await this.currencies.findById(changes.crossBorderCurrencyId))
    ) {
      throw new BadRequestException(
        `Currency ${changes.crossBorderCurrencyId} does not exist`,
      );
    }
  }
}

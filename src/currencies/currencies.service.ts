import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CountriesService } from '../countries/countries.service';
import { Currency } from './entities/currency.entity';
import { CreateCurrencyInput } from './types/create-currency-input';
import { CurrencyChanges } from './types/currency-changes';

@Injectable()
export class CurrenciesService {
  constructor(
    @InjectRepository(Currency)
    private readonly currencies: Repository<Currency>,
    private readonly countries: CountriesService,
  ) {}

  async create(input: CreateCurrencyInput): Promise<Currency> {
    await this.assertIsocodeIsFree(input.isocode);
    await this.assertCountryExists(input.countryId);

    const currency = await this.currencies.save(
      this.currencies.create({
        name: input.name,
        isocode: input.isocode,
        countryId: input.countryId,
      }),
    );

    return this.findById(currency.id);
  }

  async list(): Promise<Currency[]> {
    return this.currencies.find({
      relations: { country: true },
      order: { isocode: 'ASC' },
    });
  }

  async findById(id: number): Promise<Currency> {
    return this.currencies.findOne({
      where: { id },
      relations: { country: true },
    });
  }

  async findByIds(ids: number[]): Promise<Currency[]> {
    if (ids.length === 0) return [];

    return this.currencies.find({ where: { id: In(ids) } });
  }

  async update(id: number, changes: CurrencyChanges): Promise<Currency> {
    const currency = await this.findById(id);

    if (!currency) throw new NotFoundException('Currency not found');

    if (changes.isocode !== undefined) {
      await this.assertIsocodeIsFree(changes.isocode, id);
    }

    if (changes.countryId !== undefined) {
      await this.assertCountryExists(changes.countryId);
    }

    await this.currencies.save(this.currencies.merge(currency, changes));

    return this.findById(id);
  }

  private async assertIsocodeIsFree(
    isocode: string,
    ownedBy?: number,
  ): Promise<void> {
    const holder = await this.currencies.findOne({ where: { isocode } });

    if (holder && holder.id !== ownedBy) {
      throw new ConflictException(`The currency ${isocode} already exists`);
    }
  }

  private async assertCountryExists(countryId: number): Promise<void> {
    if (!(await this.countries.findById(countryId))) {
      throw new BadRequestException(`Country ${countryId} does not exist`);
    }
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Country } from './entities/country.entity';
import { CountryChanges } from './types/country-changes';
import { CreateCountryInput } from './types/create-country-input';

@Injectable()
export class CountriesService {
  constructor(
    @InjectRepository(Country)
    private readonly countries: Repository<Country>,
  ) {}

  async create(input: CreateCountryInput): Promise<Country> {
    await this.assertNameIsFree(input.name);

    return this.countries.save(this.countries.create({ name: input.name }));
  }

  async list(): Promise<Country[]> {
    return this.countries.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<Country> {
    return this.countries.findOne({ where: { id } });
  }

  async update(id: number, changes: CountryChanges): Promise<Country> {
    const country = await this.findById(id);

    if (!country) throw new NotFoundException('Country not found');

    if (changes.name !== undefined) {
      await this.assertNameIsFree(changes.name, id);
    }

    return this.countries.save(this.countries.merge(country, changes));
  }

  private async assertNameIsFree(
    name: string,
    ownedBy?: number,
  ): Promise<void> {
    const holder = await this.countries.findOne({ where: { name } });

    if (holder && holder.id !== ownedBy) {
      throw new ConflictException(`The country ${name} already exists`);
    }
  }
}

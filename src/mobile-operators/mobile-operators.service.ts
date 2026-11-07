import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, Repository } from 'typeorm';
import { Page, toPage } from '../common/types/page';
import { CountriesService } from '../countries/countries.service';
import { MobileOperator } from './entities/mobile-operator.entity';
import { CreateMobileOperatorInput } from './types/create-mobile-operator-input';
import { MobileOperatorChanges } from './types/mobile-operator-changes';
import { MobileOperatorListQuery } from './types/mobile-operator-list-query';
import { mobileOperatorListOrder } from './utils/mobile-operator-list-order';
import { mobileOperatorListWhere } from './utils/mobile-operator-list-where';

const RELATIONS: FindOptionsRelations<MobileOperator> = { country: true };

@Injectable()
export class MobileOperatorsService {
  constructor(
    @InjectRepository(MobileOperator)
    private readonly operators: Repository<MobileOperator>,
    private readonly countries: CountriesService,
  ) {}

  async create(input: CreateMobileOperatorInput): Promise<MobileOperator> {
    await this.assertCodeIsFree(input.code);
    await this.assertCountryExists(input.countryId);

    const operator = await this.operators.save(
      this.operators.create({
        code: input.code,
        name: input.name,
        countryId: input.countryId,
        ...(input.active !== undefined ? { active: input.active } : {}),
      }),
    );

    return this.findById(operator.id);
  }

  async list(query: MobileOperatorListQuery): Promise<Page<MobileOperator>> {
    return toPage(
      await this.operators.findAndCount({
        where: mobileOperatorListWhere(query),
        order: mobileOperatorListOrder(query),
        relations: RELATIONS,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  findActiveByCode(code: string): Promise<MobileOperator | null> {
    return this.operators.findOne({ where: { code, active: true } });
  }

  async findById(id: number): Promise<MobileOperator> {
    return this.operators.findOne({ where: { id }, relations: RELATIONS });
  }

  async update(
    id: number,
    changes: MobileOperatorChanges,
  ): Promise<MobileOperator> {
    const operator = await this.findById(id);

    if (!operator) throw new NotFoundException('Mobile operator not found');

    if (changes.code !== undefined) {
      await this.assertCodeIsFree(changes.code, id);
    }

    if (changes.countryId !== undefined) {
      await this.assertCountryExists(changes.countryId);
    }

    await this.operators.save(this.operators.merge(operator, changes));

    return this.findById(id);
  }

  private async assertCodeIsFree(
    code: string,
    ownedBy?: number,
  ): Promise<void> {
    const holder = await this.operators.findOne({ where: { code } });

    if (holder && holder.id !== ownedBy) {
      throw new ConflictException(
        `The mobile operator code ${code} is already taken`,
      );
    }
  }

  private async assertCountryExists(countryId: number): Promise<void> {
    if (!(await this.countries.findById(countryId))) {
      throw new BadRequestException(`Country ${countryId} does not exist`);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Page, toPage } from '../common/types/page';
import { sortDirection } from '../common/utils/sort-direction';
import { Counterparty } from './entities/counterparty.entity';
import { CounterpartyData } from './types/counterparty-data';
import { CounterpartyListQuery } from './types/counterparty-list-query';
import { CounterpartySortField } from './types/counterparty-sort-field.enum';
import { counterpartyListWhere } from './utils/counterparty-list-where';

@Injectable()
export class CounterpartiesService {
  constructor(
    @InjectRepository(Counterparty)
    private readonly counterparties: Repository<Counterparty>,
  ) {}

  findById(id: number): Promise<Counterparty | null> {
    return this.counterparties.findOne({ where: { id } });
  }

  async list(query: CounterpartyListQuery): Promise<Page<Counterparty>> {
    const direction = sortDirection(query.sortOrder);
    const order =
      query.sortBy === CounterpartySortField.Id
        ? { id: direction }
        : { createdAt: direction, id: direction };

    return toPage(
      await this.counterparties.findAndCount({
        where: counterpartyListWhere(query),
        order,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async findOrCreate(
    merchantId: string,
    externalId: string,
    data: CounterpartyData = {},
  ): Promise<Counterparty> {
    const existing = await this.counterparties.findOne({
      where: { merchantId, externalId },
    });
    if (existing) return existing;

    return this.counterparties.save(
      this.counterparties.create({
        merchantId,
        externalId,
        name: data.name ?? null,
        contact: data.contact ?? null,
        payload: data.payload ?? null,
      }),
    );
  }
}

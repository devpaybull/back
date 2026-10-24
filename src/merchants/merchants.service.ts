import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import { ILike, Repository } from 'typeorm';
import { Page, toPage } from '../common/types/page';
import { escapeLikePattern } from '../common/utils/escape-like-pattern';
import { sortDirection } from '../common/utils/sort-direction';
import { Merchant } from './entities/merchant.entity';
import { MerchantApiKey } from './entities/merchant-api-key.entity';
import { MerchantListQuery } from './types/merchant-list-query';
import { MerchantSortField } from './types/merchant-sort-field.enum';

@Injectable()
export class MerchantsService {
  constructor(
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectRepository(MerchantApiKey)
    private readonly keys: Repository<MerchantApiKey>,
  ) {}

  findById(id: string): Promise<Merchant | null> {
    return this.merchants.findOne({ where: { id } });
  }

  create(name: string): Promise<Merchant> {
    return this.merchants.save(this.merchants.create({ name }));
  }

  createKey(merchantId: string): Promise<MerchantApiKey> {
    return this.keys.save(
      this.keys.create({
        merchantId,
        key: randomUUID(),
        secret: randomBytes(32).toString('hex'),
      }),
    );
  }

  async list(query: MerchantListQuery): Promise<Page<Merchant>> {
    const direction = sortDirection(query.sortOrder);
    const order =
      query.sortBy === MerchantSortField.Name
        ? { name: direction, id: direction }
        : query.sortBy === MerchantSortField.Id
          ? { id: direction }
          : { createdAt: direction, id: direction };

    const where = query.search
      ? { name: ILike(`%${escapeLikePattern(query.search)}%`) }
      : {};

    return toPage(
      await this.merchants.findAndCount({
        where,
        order,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }
}

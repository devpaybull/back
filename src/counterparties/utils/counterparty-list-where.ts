import { FindOptionsWhere, ILike } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { Counterparty } from '../entities/counterparty.entity';
import { CounterpartyListQuery } from '../types/counterparty-list-query';

export const counterpartyListWhere = (
  query: CounterpartyListQuery,
): FindOptionsWhere<Counterparty> | FindOptionsWhere<Counterparty>[] => {
  const filter: FindOptionsWhere<Counterparty> = {};
  if (query.merchantId !== undefined) filter.merchantId = query.merchantId;

  if (!query.search) return filter;

  const term = `%${escapeLikePattern(query.search)}%`;

  return [
    { ...filter, externalId: ILike(term) },
    { ...filter, name: ILike(term) },
  ];
};

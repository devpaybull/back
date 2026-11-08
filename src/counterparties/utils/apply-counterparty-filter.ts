import { Brackets, SelectQueryBuilder } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { formatFiat } from '../../common/utils/format-fiat';
import { Counterparty } from '../entities/counterparty.entity';
import { AmountRange } from '../types/amount-range';
import { CounterpartyFilter } from '../types/counterparty-filter';
import { CounterpartyStatus } from '../types/counterparty-status.enum';
import { windowStartDays } from './window-start-days';
import { windowVolumeSql } from './window-volume-sql';

const applyAmountRange = (
  query: SelectQueryBuilder<Counterparty>,
  expression: string,
  range: AmountRange | undefined,
  key: string,
): void => {
  if (range?.from !== undefined) {
    query.andWhere(`${expression} >= :${key}From`, {
      [`${key}From`]: formatFiat(range.from),
    });
  }
  if (range?.to !== undefined) {
    query.andWhere(`${expression} <= :${key}To`, {
      [`${key}To`]: formatFiat(range.to),
    });
  }
};

export function applyCounterpartyFilter(
  query: SelectQueryBuilder<Counterparty>,
  filter: CounterpartyFilter,
  today: string,
): SelectQueryBuilder<Counterparty> {
  query.setParameters(windowStartDays(today));

  if (filter.search) {
    const term = `%${escapeLikePattern(filter.search)}%`;
    query.andWhere(
      new Brackets((inner) => {
        inner.where('counterparty.externalId ILIKE :term', { term });
        if (filter.searchMerchantIds?.length) {
          inner.orWhere('counterparty.merchantId IN (:...searchMerchantIds)', {
            searchMerchantIds: filter.searchMerchantIds,
          });
        }
        if (filter.searchBankDetailsIds?.length) {
          inner.orWhere(
            'counterparty.bankDetailsId IN (:...searchBankDetailsIds)',
            { searchBankDetailsIds: filter.searchBankDetailsIds },
          );
        }
      }),
    );
  }

  if (filter.merchantId !== undefined) {
    query.andWhere('counterparty.merchantId = :merchantId', {
      merchantId: filter.merchantId,
    });
  }
  if (filter.bankDetailsIds !== undefined) {
    query.andWhere('counterparty.bankDetailsId IN (:...bankDetailsIds)', {
      bankDetailsIds: filter.bankDetailsIds,
    });
  }
  if (filter.status !== undefined) {
    query.andWhere('counterparty.enabled = :enabled', {
      enabled: filter.status === CounterpartyStatus.Enabled,
    });
  }
  if (filter.blacklisted !== undefined) {
    query.andWhere(
      filter.blacklisted
        ? 'counterparty.blacklistedAt IS NOT NULL'
        : 'counterparty.blacklistedAt IS NULL',
    );
  }
  if (filter.autoEnableForbidden !== undefined) {
    query.andWhere('counterparty.autoEnableForbidden = :autoEnableForbidden', {
      autoEnableForbidden: filter.autoEnableForbidden,
    });
  }
  if (filter.hasRequisite !== undefined) {
    query.andWhere(
      filter.hasRequisite
        ? 'counterparty.bankDetailsId IS NOT NULL'
        : 'counterparty.bankDetailsId IS NULL',
    );
  }

  for (const [window, range] of filter.windowVolumes ?? []) {
    applyAmountRange(
      query,
      windowVolumeSql(window, 'paidAmount'),
      range,
      `volume${window}d`,
    );
  }
  applyAmountRange(
    query,
    'counterparty.paidAmount',
    filter.totalVolume,
    'volumeTotal',
  );

  const paidIn30Days = windowVolumeSql(30, 'paidCount');
  if (filter.paid30d?.from !== undefined) {
    query.andWhere(`${paidIn30Days} >= :paid30dFrom`, {
      paid30dFrom: filter.paid30d.from,
    });
  }
  if (filter.paid30d?.to !== undefined) {
    query.andWhere(`${paidIn30Days} <= :paid30dTo`, {
      paid30dTo: filter.paid30d.to,
    });
  }

  const requestsIn30Days =
    'COALESCE((SELECT SUM(requests."requestCount") FROM counterparty_daily_requests requests WHERE requests."counterpartyId" = counterparty.id AND requests.day >= :since30), 0)';
  if (filter.requests30d?.from !== undefined) {
    query.andWhere(`${requestsIn30Days} >= :requests30dFrom`, {
      requests30dFrom: filter.requests30d.from,
    });
  }
  if (filter.requests30d?.to !== undefined) {
    query.andWhere(`${requestsIn30Days} <= :requests30dTo`, {
      requests30dTo: filter.requests30d.to,
    });
  }

  return query;
}

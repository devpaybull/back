import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { VictoriaLogsService } from '../../audit/services/victoria-logs.service';
import { VictoriaLine } from '../../audit/types/victoria-line';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { Page, toPage } from '../../common/types/page';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { formatFiat } from '../../common/utils/format-fiat';
import { sortDirection } from '../../common/utils/sort-direction';
import { toFiat } from '../../common/utils/to-fiat';
import { SelectionSummary } from '../../transactions/types/selection-summary';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { CounterpartyDayRequests } from '../../counterparties/types/counterparty-day-requests';
import { CounterpartyRequestTotals } from '../../counterparties/types/counterparty-request-totals';
import { MerchantApiRequest } from '../entities/merchant-api-request.entity';
import { MerchantRequestArchiveReach } from '../types/merchant-request-archive-reach';
import { CounterpartyRequestCounts } from '../types/counterparty-request-counts';
import { MerchantRequestCounters } from '../types/merchant-request-counters';
import { MerchantRequestFilter } from '../types/merchant-request-filter';
import { MerchantRequestListQuery } from '../types/merchant-request-list-query';
import { MerchantRequestOperation } from '../types/merchant-request-operation.enum';
import { MerchantRequestRecord } from '../types/merchant-request-record';
import { MerchantRequestResult } from '../types/merchant-request-result.enum';
import { MerchantRequestSegment } from '../types/merchant-request-segment';
import { MerchantRequestSlice } from '../types/merchant-request-slice';
import { MerchantRequestSortField } from '../types/merchant-request-sort-field.enum';
import { MerchantRequestSummary } from '../types/merchant-request-summary';
import { MERCHANT_REQUEST_ARCHIVE_SOURCE } from '../utils/merchant-request-archive-source';
import { MERGED_SORT_WINDOW_MAX } from '../../common/utils/merged-sort-window-max';

const SUMMARY_COLUMNS = [
  'id',
  'merchantId',
  'statusCode',
  'errorCode',
  'durationMs',
  'result',
  'operation',
  'direction',
  'paymentMethod',
  'amountFiat',
  'currency',
  'requestedBankId',
  'payerUserId',
  'merchantTransactionId',
  'transactionId',
  'processedByUserId',
  'counterpartyId',
  'receivedAt',
] as const;
const ARCHIVE_SUMMARY_FIELDS = SUMMARY_COLUMNS.map((column) =>
  column === 'id' ? 'requestId' : column,
).join(', ');
const ONE_LINE_PER_REQUEST =
  'sort by (requestId) partition by (requestId) limit 1';
const RANGE_FLOOR = '0';
const RANGE_CEILING = '~';
const UNRANKED = Number.MAX_SAFE_INTEGER;
const ARCHIVE_TIME_SLACK_MS = 60 * 60 * 1000;
const EPOCH = new Date(0);
const ARCHIVE_UNAVAILABLE = 'The request log archive is unavailable';

const SORT_COLUMN: Record<
  Exclude<MerchantRequestSortField, MerchantRequestSortField.Merchant>,
  { postgres: string; archive: string }
> = {
  [MerchantRequestSortField.ReceivedAt]: {
    postgres: 'request.receivedAt',
    archive: 'receivedAt',
  },
  [MerchantRequestSortField.Amount]: {
    postgres: 'request.amountFiat',
    archive: 'amountFiat',
  },
  [MerchantRequestSortField.PayerUserId]: {
    postgres: '"request"."payerUserId" COLLATE "C"',
    archive: 'payerUserId',
  },
};

type KeyedSort = Exclude<
  MerchantRequestSortField,
  MerchantRequestSortField.Merchant
>;

const quoted = (value: string): string => JSON.stringify(value);

const codeUnitOrder = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const byteOrder = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

const lowerUuid = (value: string): string =>
  isUUID(value) ? value.toLowerCase() : value;

const keyOrder: Record<
  KeyedSort,
  (a: MerchantRequestSummary, b: MerchantRequestSummary) => number
> = {
  [MerchantRequestSortField.ReceivedAt]: () => 0,
  [MerchantRequestSortField.Amount]: (a, b) =>
    (a.amountFiat as NonNullable<typeof a.amountFiat>).comparedTo(
      b.amountFiat as NonNullable<typeof b.amountFiat>,
    ),
  [MerchantRequestSortField.PayerUserId]: (a, b) =>
    byteOrder(a.payerUserId ?? '', b.payerUserId ?? ''),
};

const rowOrder =
  (key: KeyedSort, order: SortOrder) =>
  (a: MerchantRequestSummary, b: MerchantRequestSummary): number =>
    (order === SortOrder.Asc ? 1 : -1) *
    (keyOrder[key](a, b) ||
      a.receivedAt.getTime() - b.receivedAt.getTime() ||
      codeUnitOrder(a.id, b.id));

const concat = async (
  segments: MerchantRequestSegment[],
  skip: number,
  take: number,
): Promise<[MerchantRequestSummary[], number]> => {
  const rows: MerchantRequestSummary[] = [];
  let offset = skip;
  let total = 0;

  for (const segment of segments) {
    const [part, count] = await segment(offset, take - rows.length);

    rows.push(...part);
    total += count;
    offset = Math.max(0, offset - count);
  }

  return [rows, total];
};

const orNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

const summaryOf = (line: VictoriaLine): MerchantRequestSummary => {
  const amount = orNull(line.amountFiat);
  const bankId = orNull(line.requestedBankId);
  const counterparty = orNull(line.counterpartyId);

  return {
    id: line.requestId as string,
    merchantId: line.merchantId as string,
    statusCode: Number(line.statusCode),
    errorCode: orNull(line.errorCode),
    durationMs: Number(line.durationMs),
    result: line.result as MerchantRequestResult,
    operation: orNull(line.operation) as MerchantRequestOperation | null,
    direction: orNull(line.direction) as TransactionKind | null,
    paymentMethod: orNull(line.paymentMethod),
    amountFiat: amount === null ? null : toFiat(amount),
    currency: orNull(line.currency),
    requestedBankId: bankId === null ? null : Number(bankId),
    payerUserId: orNull(line.payerUserId),
    merchantTransactionId: orNull(line.merchantTransactionId),
    transactionId: orNull(line.transactionId),
    processedByUserId: orNull(line.processedByUserId),
    counterpartyId: counterparty === null ? null : Number(counterparty),
    receivedAt: new Date(line.receivedAt as string),
  };
};

const recordOf = (line: VictoriaLine): MerchantRequestRecord => {
  const headers = orNull(line.requestHeaders);
  const summary = orNull(line.selectionSummary);

  return {
    ...summaryOf(line),
    apiKeyId: Number(line.apiKeyId),
    method: line.method as string,
    path: line.path as string,
    ip: orNull(line.ip),
    requestHeaders:
      headers === null ? {} : (JSON.parse(headers) as Record<string, string>),
    requestBody: orNull(line.requestBody),
    requestBodyTruncated: line.requestBodyTruncated === 'true',
    responseBody: orNull(line.responseBody),
    responseBodyTruncated: line.responseBodyTruncated === 'true',
    selectionSummary:
      summary === null ? null : (JSON.parse(summary) as SelectionSummary),
  };
};

@Injectable()
export class MerchantRequestHistoryService {
  private readonly logger = new Logger(MerchantRequestHistoryService.name);

  constructor(
    @InjectRepository(MerchantApiRequest)
    private readonly requests: Repository<MerchantApiRequest>,
    private readonly victoria: VictoriaLogsService,
  ) {}

  async list(
    query: MerchantRequestListQuery,
  ): Promise<Page<MerchantRequestSummary>> {
    const window = query.page * query.limit;

    if (
      (query.sortBy === MerchantRequestSortField.Amount ||
        query.sortBy === MerchantRequestSortField.PayerUserId) &&
      window > MERGED_SORT_WINDOW_MAX
    ) {
      throw new BadRequestException(
        `Sorted by ${query.sortBy}, a page may end at most ${MERGED_SORT_WINDOW_MAX} rows deep; narrow the filters or sort by receivedAt`,
      );
    }

    const reach = await this.archiveReach();
    const segments =
      query.sortBy === MerchantRequestSortField.Merchant
        ? await this.merchantSegments(query, reach)
        : this.keyedSegments(query, query.sortBy, query.sortOrder, reach);

    return toPage(
      await concat(segments, (query.page - 1) * query.limit, query.limit),
      query,
    );
  }

  async counters(
    filter: MerchantRequestFilter,
  ): Promise<MerchantRequestCounters> {
    const reach = await this.archiveReach();
    const slice = { ...filter, result: undefined };
    const [stored, archived] = await Promise.all([
      this.where(slice)
        .select('request.result', 'key')
        .addSelect('COUNT(*)', 'total')
        .groupBy('request.result')
        .getRawMany<{ key: string; total: string }>(),
      this.archiveCountsBy('result', slice, reach),
    ]);
    const counts = new Map<string, number>(archived);

    for (const row of stored) {
      counts.set(row.key, (counts.get(row.key) ?? 0) + Number(row.total));
    }

    return {
      all: [...counts.values()].reduce((sum, count) => sum + count, 0),
      created: counts.get(MerchantRequestResult.Created) ?? 0,
      notCreated: counts.get(MerchantRequestResult.NotCreated) ?? 0,
    };
  }

  async export(
    filter: MerchantRequestFilter,
    maxRows: number,
  ): Promise<MerchantRequestSummary[]> {
    const reach = await this.archiveReach();
    const [rows] = await concat(
      this.timeSegments(filter, SortOrder.Desc, reach),
      0,
      maxRows + 1,
    );

    if (rows.length > maxRows) {
      throw new BadRequestException(
        `More than ${maxRows} requests match; narrow the period or the filters`,
      );
    }

    return rows;
  }

  async findById(id: string): Promise<MerchantRequestRecord | null> {
    const stored = await this.requests.findOne({ where: { id } });

    if (stored) return stored;

    if (!this.victoria.enabled) return null;

    const [record] = await this.archive(
      `source:=${quoted(MERCHANT_REQUEST_ARCHIVE_SOURCE)} requestId:=${quoted(id.toLowerCase())} | limit 1`,
      recordOf,
    );

    return record ?? null;
  }

  async countForCounterparty(
    counterpartyId: number,
    paymentMethod?: string,
  ): Promise<number> {
    const reach = await this.archiveReach();
    const slice = { counterpartyId, paymentMethod };
    const [stored, archived] = await Promise.all([
      this.where(slice).getCount(),
      reach ? this.archiveCount(slice, reach) : 0,
    ]);

    return stored + archived;
  }

  async listForCounterparty(
    counterpartyId: number,
    order: SortOrder,
    take: number,
  ): Promise<[MerchantRequestSummary[], number]> {
    const reach = await this.archiveReach();

    return concat(this.timeSegments({ counterpartyId }, order, reach), 0, take);
  }

  async counterpartyRequestCounts(
    timeZone: string,
  ): Promise<CounterpartyRequestCounts> {
    const reach = await this.archiveReach();
    const [stored, archived] = await Promise.all([
      this.requests
        .createQueryBuilder('request')
        .select('request.counterpartyId', 'counterpartyId')
        .addSelect(
          `to_char(request.receivedAt AT TIME ZONE :timeZone, 'YYYY-MM-DD')`,
          'day',
        )
        .addSelect('COUNT(*)', 'total')
        .addSelect('MAX(request.receivedAt)', 'last')
        .where('request.counterpartyId IS NOT NULL')
        .setParameter('timeZone', timeZone)
        .groupBy('request.counterpartyId')
        .addGroupBy('day')
        .getRawMany<{
          counterpartyId: number;
          day: string;
          total: string;
          last: Date | string;
        }>(),
      this.archivedCounterpartyBuckets(reach),
    ]);
    const days = new Map<string, CounterpartyDayRequests>();
    const totals = new Map<number, CounterpartyRequestTotals>();
    const add = (
      counterpartyId: number,
      day: string,
      count: number,
      last: Date,
    ): void => {
      const dayKey = `${counterpartyId}:${day}`;
      const bucket = days.get(dayKey);
      const total = totals.get(counterpartyId);

      days.set(dayKey, {
        counterpartyId,
        day,
        requestCount: (bucket?.requestCount ?? 0) + count,
      });
      totals.set(counterpartyId, {
        counterpartyId,
        requestCount: (total?.requestCount ?? 0) + count,
        lastRequestAt:
          total?.lastRequestAt && total.lastRequestAt > last
            ? total.lastRequestAt
            : last,
      });
    };

    for (const row of stored) {
      add(
        Number(row.counterpartyId),
        row.day,
        Number(row.total),
        new Date(row.last),
      );
    }

    for (const bucket of archived) {
      add(
        bucket.counterpartyId,
        calendarDateIn(bucket.receivedAt, timeZone),
        bucket.count,
        bucket.receivedAt,
      );
    }

    return { totals: [...totals.values()], days: [...days.values()] };
  }

  private async archivedCounterpartyBuckets(
    reach: MerchantRequestArchiveReach | null,
  ): Promise<{ counterpartyId: number; receivedAt: Date; count: number }[]> {
    if (!reach) return [];

    const filter = this.archiveFilter({}, reach);

    if (filter === null) return [];

    return this.archive(
      `${filter} counterpartyId:* | fields requestId, counterpartyId, receivedAt | ${ONE_LINE_PER_REQUEST} | stats by (counterpartyId, receivedAt) count() total`,
      (line) => {
        const receivedAt = new Date(line.receivedAt as string);

        if (Number.isNaN(receivedAt.getTime())) {
          throw new Error(`Unreadable receivedAt ${line.receivedAt}`);
        }

        return {
          counterpartyId: Number(line.counterpartyId),
          receivedAt,
          count: Number(line.total ?? 0),
        };
      },
    );
  }

  private keyedSegments(
    filter: MerchantRequestFilter,
    key: KeyedSort,
    order: SortOrder,
    reach: MerchantRequestArchiveReach | null,
  ): MerchantRequestSegment[] {
    if (key === MerchantRequestSortField.ReceivedAt) {
      return this.timeSegments(filter, order, reach);
    }

    const field =
      key === MerchantRequestSortField.Amount ? 'amountFiat' : 'payerUserId';
    const valued = this.mergedSegment(
      { ...filter, present: { field, is: true } },
      key,
      order,
      reach,
    );
    const empty = this.timeSegments(
      { ...filter, present: { field, is: false } },
      order,
      reach,
    );

    return order === SortOrder.Asc ? [...empty, valued] : [valued, ...empty];
  }

  private timeSegments(
    slice: MerchantRequestSlice,
    order: SortOrder,
    reach: MerchantRequestArchiveReach | null,
  ): MerchantRequestSegment[] {
    const key = MerchantRequestSortField.ReceivedAt;
    const stored = this.postgresSegment(slice, key, order);

    if (!reach) return [stored];

    const archived = this.archiveSegment(slice, key, order, reach);

    return order === SortOrder.Asc ? [archived, stored] : [stored, archived];
  }

  private mergedSegment(
    slice: MerchantRequestSlice,
    key: KeyedSort,
    order: SortOrder,
    reach: MerchantRequestArchiveReach | null,
  ): MerchantRequestSegment {
    const stored = this.postgresSegment(slice, key, order);

    if (!reach) return stored;

    return async (skip, take) => {
      const [[, storedTotal], archivedTotal] = await Promise.all([
        stored(0, 0),
        this.archiveCount(slice, reach),
      ]);
      const total = storedTotal + archivedTotal;

      if (take <= 0 || skip >= total) return [[], total];

      if (archivedTotal > MERGED_SORT_WINDOW_MAX) {
        throw new BadRequestException(
          `More than ${MERGED_SORT_WINDOW_MAX} archived requests match; narrow the period or sort by receivedAt`,
        );
      }

      const [[storedRows], archivedRows] = await Promise.all([
        stored(0, skip + take),
        this.archiveAll(slice, reach, archivedTotal),
      ]);
      const rows = [...storedRows, ...archivedRows]
        .sort(rowOrder(key, order))
        .slice(skip, skip + take);

      return [rows, total];
    };
  }

  private async merchantSegments(
    query: MerchantRequestListQuery,
    reach: MerchantRequestArchiveReach | null,
  ): Promise<MerchantRequestSegment[]> {
    const [stored, archived] = await Promise.all([
      this.where(query)
        .select('request.merchantId', 'key')
        .addSelect('COUNT(*)', 'total')
        .groupBy('request.merchantId')
        .getRawMany<{ key: string; total: string }>(),
      this.archiveCountsBy('merchantId', query, reach),
    ]);
    const counts = new Map<string, number>(archived);

    for (const row of stored) {
      counts.set(row.key, (counts.get(row.key) ?? 0) + Number(row.total));
    }

    const rankOf = (merchantId: string): number =>
      query.merchantRanks?.get(merchantId) ?? UNRANKED;
    const merchantIds = [...counts.keys()].sort(
      (a, b) => rankOf(a) - rankOf(b) || codeUnitOrder(a, b),
    );

    if (query.sortOrder === SortOrder.Desc) merchantIds.reverse();

    return merchantIds.map((merchantId) => {
      const count = counts.get(merchantId) ?? 0;

      return async (skip, take) => {
        if (take <= 0 || skip >= count) return [[], count];

        const [rows] = await concat(
          this.timeSegments({ ...query, merchantId }, query.sortOrder, reach),
          skip,
          take,
        );

        return [rows, count];
      };
    });
  }

  private postgresSegment(
    slice: MerchantRequestSlice,
    key: KeyedSort,
    order: SortOrder,
  ): MerchantRequestSegment {
    return async (skip, take) => {
      const builder = this.where(slice);

      if (take <= 0) return [[], await builder.getCount()];

      const direction = sortDirection(order);

      if (key !== MerchantRequestSortField.ReceivedAt) {
        builder.orderBy(SORT_COLUMN[key].postgres, direction);
      }

      return builder
        .select(SUMMARY_COLUMNS.map((column) => `request.${column}`))
        .addOrderBy('request.receivedAt', direction)
        .addOrderBy('request.id', direction)
        .offset(skip)
        .limit(take)
        .getManyAndCount();
    };
  }

  private archiveSegment(
    slice: MerchantRequestSlice,
    key: KeyedSort,
    order: SortOrder,
    reach: MerchantRequestArchiveReach,
  ): MerchantRequestSegment {
    return async (skip, take) => {
      const filter = this.archiveFilter(slice, reach);

      if (filter === null) return [[], 0];

      const [total] = await this.archive(
        `${filter} | stats count_uniq(requestId) total`,
        (line) => Number(line.total ?? 0),
      );

      if (take <= 0 || !total || skip >= total) return [[], total ?? 0];

      const suffix = order === SortOrder.Asc ? '' : ' desc';
      const sortKeys = [
        ...(key === MerchantRequestSortField.ReceivedAt
          ? []
          : [SORT_COLUMN[key].archive]),
        'receivedAt',
        'requestId',
      ]
        .map((field) => `${field}${suffix}`)
        .join(', ');
      const rows = await this.archive(
        `${filter} | fields ${ARCHIVE_SUMMARY_FIELDS} | ${ONE_LINE_PER_REQUEST} | sort by (${sortKeys}) offset ${skip} limit ${take}`,
        summaryOf,
      );

      return [rows, total];
    };
  }

  private async archiveCountsBy(
    field: 'result' | 'merchantId',
    slice: MerchantRequestSlice,
    reach: MerchantRequestArchiveReach | null,
  ): Promise<[string, number][]> {
    if (!reach) return [];

    const filter = this.archiveFilter(slice, reach);

    if (filter === null) return [];

    const counts = await this.archive(
      `${filter} | stats by (${field}) count_uniq(requestId) total`,
      (line): [string | null, number] => [
        orNull(line[field]),
        Number(line.total ?? 0),
      ],
    );

    return counts.filter(
      (entry): entry is [string, number] => entry[0] !== null,
    );
  }

  private where(
    slice: MerchantRequestSlice,
  ): SelectQueryBuilder<MerchantApiRequest> {
    const builder = this.requests.createQueryBuilder('request');

    if (slice.receivedFrom) {
      builder.andWhere('request.receivedAt >= :receivedFrom', {
        receivedFrom: slice.receivedFrom,
      });
    }

    if (slice.receivedBefore) {
      builder.andWhere('request.receivedAt < :receivedBefore', {
        receivedBefore: slice.receivedBefore,
      });
    }

    if (slice.result) {
      builder.andWhere('request.result = :result', { result: slice.result });
    }

    if (slice.merchantId) {
      builder.andWhere('request.merchantId = :merchantId', {
        merchantId: slice.merchantId,
      });
    }

    if (slice.counterpartyId !== undefined) {
      builder.andWhere('request.counterpartyId = :counterpartyId', {
        counterpartyId: slice.counterpartyId,
      });
    }

    if (slice.operations?.length) {
      builder.andWhere('request.operation IN (:...operations)', {
        operations: [...slice.operations],
      });
    }

    if (slice.direction) {
      builder.andWhere('request.direction = :direction', {
        direction: slice.direction,
      });
    }

    if (slice.paymentMethod) {
      builder.andWhere('request.paymentMethod = :paymentMethod', {
        paymentMethod: slice.paymentMethod,
      });
    }

    if (slice.requestedBankId === null) {
      builder.andWhere('request.requestedBankId IS NULL');
    } else if (slice.requestedBankId !== undefined) {
      builder.andWhere('request.requestedBankId = :requestedBankId', {
        requestedBankId: slice.requestedBankId,
      });
    }

    if (slice.amountFrom) {
      builder.andWhere('request.amountFiat >= :amountFrom', {
        amountFrom: formatFiat(slice.amountFrom),
      });
    }

    if (slice.amountTo) {
      builder.andWhere('request.amountFiat <= :amountTo', {
        amountTo: formatFiat(slice.amountTo),
      });
    }

    if (slice.search) {
      const search = slice.search;
      const merchantIds = slice.searchMerchantIds ?? [];

      builder.andWhere(
        new Brackets((inner) => {
          inner.where('request.merchantTransactionId = :search', { search });

          if (isUUID(search)) {
            inner
              .orWhere('request.id = :searchId', { searchId: search })
              .orWhere('request.transactionId = :searchId');
          }

          if (merchantIds.length > 0) {
            inner.orWhere('request.merchantId IN (:...searchMerchantIds)', {
              searchMerchantIds: [...merchantIds],
            });
          }
        }),
      );
    }

    if (slice.present) {
      builder.andWhere(
        `request.${slice.present.field} IS ${slice.present.is ? 'NOT ' : ''}NULL`,
      );
    }

    return builder;
  }

  private archiveFilter(
    slice: MerchantRequestSlice,
    reach: MerchantRequestArchiveReach,
  ): string | null {
    const upper = [reach.below, slice.receivedBefore ?? null]
      .filter((instant): instant is Date => instant !== null)
      .reduce<Date | null>(
        (lowest, instant) =>
          lowest === null || instant < lowest ? instant : lowest,
        null,
      );
    const lower = slice.receivedFrom ?? null;

    if (lower && upper && lower >= upper) return null;

    const exact = (field: string, value: string | number): string =>
      `${field}:=${quoted(String(value))}`;
    const search = slice.search;
    const merchantIds = (slice.searchMerchantIds ?? []).map(lowerUuid);
    const timeRange = upper
      ? [
          `_time:[${new Date((lower ?? EPOCH).getTime() - ARCHIVE_TIME_SLACK_MS).toISOString()}, ${new Date(upper.getTime() + ARCHIVE_TIME_SLACK_MS).toISOString()})`,
        ]
      : lower
        ? [
            `_time:>=${new Date(lower.getTime() - ARCHIVE_TIME_SLACK_MS).toISOString()}`,
          ]
        : [];

    return [
      exact('source', MERCHANT_REQUEST_ARCHIVE_SOURCE),
      ...timeRange,
      `receivedAt:string_range(${quoted(lower?.toISOString() ?? RANGE_FLOOR)}, ${quoted(upper?.toISOString() ?? RANGE_CEILING)})`,
      ...(slice.result ? [exact('result', slice.result)] : []),
      ...(slice.merchantId
        ? [exact('merchantId', lowerUuid(slice.merchantId))]
        : []),
      ...(slice.counterpartyId !== undefined
        ? [exact('counterpartyId', slice.counterpartyId)]
        : []),
      ...(slice.operations?.length
        ? [`operation:in(${slice.operations.map(quoted).join(',')})`]
        : []),
      ...(slice.direction ? [exact('direction', slice.direction)] : []),
      ...(slice.paymentMethod
        ? [exact('paymentMethod', slice.paymentMethod)]
        : []),
      ...(slice.requestedBankId === null
        ? ['requestedBankId:""']
        : slice.requestedBankId !== undefined
          ? [exact('requestedBankId', slice.requestedBankId)]
          : []),
      ...(slice.amountFrom
        ? [`amountFiat:>=${formatFiat(slice.amountFrom)}`]
        : []),
      ...(slice.amountTo ? [`amountFiat:<=${formatFiat(slice.amountTo)}`] : []),
      ...(search
        ? [
            `(${[
              exact('requestId', lowerUuid(search)),
              exact('transactionId', lowerUuid(search)),
              exact('merchantTransactionId', search),
              ...(merchantIds.length > 0
                ? [`merchantId:in(${merchantIds.map(quoted).join(',')})`]
                : []),
            ].join(' or ')})`,
          ]
        : []),
      ...(slice.present
        ? [
            slice.present.is
              ? `${slice.present.field}:*`
              : `${slice.present.field}:""`,
          ]
        : []),
    ].join(' ');
  }

  private async archiveReach(): Promise<MerchantRequestArchiveReach | null> {
    if (!this.victoria.enabled) return null;

    const row = await this.requests
      .createQueryBuilder('request')
      .select('MIN(request.receivedAt)', 'oldest')
      .getRawOne<{ oldest: Date | string | null }>();
    const oldest = row?.oldest ?? null;

    return { below: oldest === null ? null : new Date(oldest) };
  }

  private async archiveCount(
    slice: MerchantRequestSlice,
    reach: MerchantRequestArchiveReach,
  ): Promise<number> {
    const filter = this.archiveFilter(slice, reach);

    if (filter === null) return 0;

    const [total] = await this.archive(
      `${filter} | stats count_uniq(requestId) total`,
      (line) => Number(line.total ?? 0),
    );

    return total ?? 0;
  }

  private async archiveAll(
    slice: MerchantRequestSlice,
    reach: MerchantRequestArchiveReach,
    expected: number,
  ): Promise<MerchantRequestSummary[]> {
    const filter = this.archiveFilter(slice, reach);

    if (filter === null || expected === 0) return [];

    return this.archive(
      `${filter} | fields ${ARCHIVE_SUMMARY_FIELDS} | ${ONE_LINE_PER_REQUEST} | limit ${expected}`,
      summaryOf,
    );
  }

  private async archive<T>(
    logsql: string,
    map: (line: VictoriaLine) => T,
  ): Promise<T[]> {
    try {
      return (await this.victoria.selectScoped(logsql)).map(map);
    } catch (error) {
      this.logger.error(
        `Request log archive read failed: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(ARCHIVE_UNAVAILABLE);
    }
  }
}

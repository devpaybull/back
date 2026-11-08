import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BanksService } from '../../banks/banks.service';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { dayPeriodRange } from '../../common/utils/day-period-range';
import { formatFiat } from '../../common/utils/format-fiat';
import { loginOf } from '../../common/utils/login-of';
import { maskIp } from '../../common/utils/mask-ip';
import { toFiat } from '../../common/utils/to-fiat';
import { MerchantRequestHistoryService } from '../../merchant-requests/services/merchant-request-history.service';
import { MerchantRequestFilter } from '../../merchant-requests/types/merchant-request-filter';
import { MerchantRequestSortField } from '../../merchant-requests/types/merchant-request-sort-field.enum';
import { MerchantRequestSummary } from '../../merchant-requests/types/merchant-request-summary';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { ListMerchantRequestsQueryDto } from '../dto/list-merchant-requests-query.dto';
import { MerchantRequestCountersDto } from '../dto/merchant-request-counters.dto';
import {
  MerchantRequestDetailDto,
  MerchantRequestPartSizeDto,
} from '../dto/merchant-request-detail.dto';
import { MerchantRequestFilterDto } from '../dto/merchant-request-filter.dto';
import { MerchantRequestDto } from '../dto/merchant-request.dto';
import { ANY_BANK } from '../utils/any-bank';
import { merchantRequestsCsv } from '../utils/merchant-requests-csv';
import { BALANCE_EXPORT_MAX_ROWS } from './admin-balances.controller';

const HEADERS_INDENT = 2;

const FORWARDED_FOR = /(for=)("[^"]*"|[^;,\s]*)/gi;
const BRACKETED = /^\[([^\]]*)\](.*)$/;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3})(:\d+)$/;

const maskForwardedNode = (node: string): string => {
  const quoted = node.startsWith('"') && node.endsWith('"') && node.length > 1;
  const bare = quoted ? node.slice(1, -1) : node;
  const bracketed = BRACKETED.exec(bare);
  const withPort = IPV4_WITH_PORT.exec(bare);
  const masked = bracketed
    ? `[${maskIp(bracketed[1])}]${bracketed[2]}`
    : withPort
      ? `${maskIp(withPort[1])}${withPort[2]}`
      : maskIp(bare);

  return quoted ? `"${masked}"` : masked;
};

const ADDRESS_HEADERS: Record<string, (value: string) => string> = {
  'x-forwarded-for': (value) =>
    value
      .split(',')
      .map((address) => maskIp(address.trim()))
      .join(', '),
  'x-real-ip': (value) => maskIp(value.trim()),
  forwarded: (value) =>
    value.replace(
      FORWARDED_FOR,
      (_match, name: string, node: string) =>
        `${name}${maskForwardedNode(node)}`,
    ),
};

const withMaskedAddresses = (
  headers: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      const mask = ADDRESS_HEADERS[name.toLowerCase()];

      return [name, mask ? mask(value) : value];
    }),
  );

const sizeOf = (text: string | null): MerchantRequestPartSizeDto =>
  text === null || text === ''
    ? { sizeBytes: 0, lines: 0 }
    : {
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        lines: text.split('\n').length,
      };

@ApiTags('Admin · Merchant requests')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/merchant-requests')
export class AdminMerchantRequestsController {
  constructor(
    private readonly history: MerchantRequestHistoryService,
    private readonly merchants: MerchantsService,
    private readonly banks: BanksService,
    private readonly directory: UserDirectoryService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'The merchants’ /v1 request log («История запросов»), Postgres and the archive together',
    description:
      'Filters: result (the tabs), merchantId, period or periodFrom/periodTo on receivedAt (default all time), amountFrom/amountTo (fiat, the requested amount), bankId (a bank id, or «any» for requests that named none), method, direction, operation, search (the exact request id, deal id or merchantTransactionId, or a piece of the merchant’s name).',
  })
  @ApiPagedResponse(MerchantRequestDto)
  async list(
    @Query() query: ListMerchantRequestsQueryDto,
  ): Promise<Page<MerchantRequestDto>> {
    const [filter, merchantRanks] = await Promise.all([
      this.filterOf(query),
      query.sortBy === MerchantRequestSortField.Merchant
        ? this.merchants.rankByName()
        : undefined,
    ]);
    const page = await this.history.list({
      ...filter,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      merchantRanks,
    });

    return new Page(await this.withDetails(page.items), page.meta);
  }

  @Get('counters')
  @ApiOperation({
    summary: 'The tab counters under the list’s filters, result aside',
  })
  @ApiEnvelopeResponse(MerchantRequestCountersDto)
  async counters(
    @Query() query: MerchantRequestFilterDto,
  ): Promise<MerchantRequestCountersDto> {
    return this.history.counters(await this.filterOf(query));
  }

  @Get('export')
  @ApiOperation({
    summary: 'The request log under the same filters as CSV',
    description: `No pagination, newest first, without headers and bodies. Comma-separated, UTF-8, CRLF line endings, header row. More than ${BALANCE_EXPORT_MAX_ROWS} matching rows is a 400: narrow the period.`,
  })
  @ApiOkResponse({
    description: 'text/csv attachment, not wrapped in the response envelope',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async export(
    @Query() query: MerchantRequestFilterDto,
  ): Promise<StreamableFile> {
    const rows = await this.history.export(
      await this.filterOf(query),
      BALANCE_EXPORT_MAX_ROWS,
    );
    const csv = merchantRequestsCsv(await this.withDetails(rows));

    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="merchant-requests.csv"',
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One logged request with its headers, body and answer',
    description:
      'The client address — `ip` and the X-Forwarded-For, X-Real-IP and Forwarded (`for=`) headers — is whole for a superadmin and masked for an admin. Not in Postgres nor in the archive: 404.',
  })
  @ApiEnvelopeResponse(MerchantRequestDetailDto)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() viewer: AuthenticatedUser,
  ): Promise<MerchantRequestDetailDto> {
    const record = await this.history.findById(id);

    if (!record) throw new NotFoundException('Request not found');

    const [row] = await this.withDetails([record]);
    const whole = viewer.role === Role.Superadmin;
    const requestHeaders = whole
      ? record.requestHeaders
      : withMaskedAddresses(record.requestHeaders);
    const headers = JSON.stringify(requestHeaders, null, HEADERS_INDENT);

    return {
      ...row,
      httpMethod: record.method,
      path: record.path,
      ip: record.ip === null || whole ? record.ip : maskIp(record.ip),
      requestHeaders,
      requestBody: record.requestBody,
      requestBodyTruncated: record.requestBodyTruncated,
      responseBody: record.responseBody,
      responseBodyTruncated: record.responseBodyTruncated,
      selectionSummary: record.selectionSummary
        ? { ...record.selectionSummary }
        : null,
      sizes: {
        headers: sizeOf(headers),
        body: sizeOf(record.requestBody),
        response: sizeOf(record.responseBody),
      },
    };
  }

  private async filterOf(
    query: MerchantRequestFilterDto,
  ): Promise<MerchantRequestFilter> {
    const range = dayPeriodRange(
      query,
      DayPeriod.AllTime,
      this.config.getOrThrow<string>('BUSINESS_TIMEZONE'),
    );
    const search = query.search === '' ? undefined : query.search;

    return {
      result: query.result,
      merchantId: query.merchantId,
      receivedFrom: range.from,
      receivedBefore: range.to,
      amountFrom:
        query.amountFrom === undefined ? undefined : toFiat(query.amountFrom),
      amountTo:
        query.amountTo === undefined ? undefined : toFiat(query.amountTo),
      requestedBankId: query.bankId === ANY_BANK ? null : query.bankId,
      paymentMethod: query.method,
      direction: query.direction,
      operations: query.operation,
      search,
      searchMerchantIds:
        search === undefined
          ? undefined
          : await this.merchants.findIdsMatching(search),
    };
  }

  private async withDetails(
    rows: MerchantRequestSummary[],
  ): Promise<MerchantRequestDto[]> {
    const distinct = <T>(values: (T | null)[]): T[] => [
      ...new Set(values.filter((value): value is T => value !== null)),
    ];
    const [merchants, banks, processors] = await Promise.all([
      this.merchants.findByIds(distinct(rows.map((row) => row.merchantId))),
      this.banks.findByIds(distinct(rows.map((row) => row.requestedBankId))),
      this.directory.findByIds(
        distinct(rows.map((row) => row.processedByUserId)),
      ),
    ]);
    const merchantById = new Map(merchants.map((row) => [row.id, row]));
    const bankById = new Map(banks.map((row) => [row.id, row]));
    const processorById = new Map(processors.map((row) => [row.id, row]));

    return rows.map((row) => {
      const bank =
        row.requestedBankId === null
          ? undefined
          : bankById.get(row.requestedBankId);
      const processor =
        row.processedByUserId === null
          ? undefined
          : processorById.get(row.processedByUserId);

      return {
        id: row.id,
        receivedAt: row.receivedAt,
        merchant: {
          id: row.merchantId,
          name: merchantById.get(row.merchantId)?.name ?? null,
        },
        operation: row.operation,
        direction: row.direction,
        method: row.paymentMethod,
        amount: row.amountFiat === null ? null : formatFiat(row.amountFiat),
        currency: row.currency,
        bank: bank ? { id: bank.id, code: bank.code, name: bank.name } : null,
        payerUserId: row.payerUserId,
        counterpartyId: row.counterpartyId,
        merchantTransactionId: row.merchantTransactionId,
        result: row.result,
        statusCode: row.statusCode,
        errorCode: row.errorCode,
        processedBy: processor
          ? { id: processor.id, login: loginOf(processor) }
          : null,
        durationMs: row.durationMs,
        transactionId: row.transactionId,
      };
    });
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import Decimal from 'decimal.js';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { Fiat } from '../../common/types/fiat';
import { AuthenticatedUser } from '../../common/types/token';
import { addCalendarDays } from '../../common/utils/add-calendar-days';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { roundCrypto } from '../../common/utils/round-crypto';
import { roundFiat } from '../../common/utils/round-fiat';
import { toDecimal } from '../../common/utils/to-decimal';
import { zonedMidnight } from '../../common/utils/zoned-midnight';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { MerchantAttachmentsService } from '../../merchants/services/merchant-attachments.service';
import { MerchantCurrenciesService } from '../../merchants/services/merchant-currencies.service';
import { MerchantSettingsService } from '../../merchants/services/merchant-settings.service';
import { MerchantMethodsService } from '../../merchants/services/merchant-methods.service';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { MerchantMethodState } from '../../merchants/types/merchant-method-state';
import { MerchantSortField } from '../../merchants/types/merchant-sort-field.enum';
import { MerchantTreeNode } from '../../merchants/types/merchant-tree-node';
import { MerchantBalanceService } from '../../transactions/services/merchant-balance.service';
import { MerchantStatsService } from '../../transactions/services/merchant-stats.service';
import { MerchantVolumeService } from '../../transactions/services/merchant-volume.service';
import { RateService } from '../../transactions/services/rate.service';
import { MethodPercent } from '../../transactions/types/method-percent';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethodDefinition } from '../../transactions/types/transaction-method-definition';
import { TRANSACTION_METHODS } from '../../transactions/utils/transaction-methods';
import { ListMerchantsQueryDto } from '../dto/list-merchants-query.dto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { isTronAddress } from '../../tron/utils/is-tron-address';
import { MerchantCardDto } from '../dto/merchant-card.dto';
import {
  MerchantCurrencyDto,
  toMerchantCurrencyDto,
} from '../dto/merchant-currency.dto';
import { MerchantKpiDto } from '../dto/merchant-kpi.dto';
import {
  MerchantSettingsDto,
  toMerchantSettingsDto,
} from '../dto/merchant-settings.dto';
import { ReplaceMerchantMarkupsDto } from '../dto/replace-merchant-markups.dto';
import { UpdateMerchantSettingsDto } from '../dto/update-merchant-settings.dto';
import { MerchantGroupRowDto } from '../dto/merchant-group-row.dto';
import { MerchantListRowDto } from '../dto/merchant-list-row.dto';
import { MerchantMethodChipDto } from '../dto/merchant-method-chip.dto';
import { MerchantMethodStateDto } from '../dto/merchant-method-state.dto';
import { MerchantMethodsDto } from '../dto/merchant-methods.dto';
import { MerchantRowDto } from '../dto/merchant-row.dto';
import { ReplaceMerchantMethodsDto } from '../dto/replace-merchant-methods.dto';
import { UpdateMerchantDto } from '../dto/update-merchant.dto';
import { MerchantVolumePeriod } from '../types/merchant-volume-period.enum';

const REGISTRY: readonly TransactionMethodDefinition[] = TRANSACTION_METHODS;

const MERCHANT_NOT_FOUND = 'Merchant not found';

const KPI_WINDOW_DAYS = 7;

const SUPERADMIN_SETTINGS: (keyof UpdateMerchantSettingsDto)[] = [
  'payoutOverdraftEnabled',
  'autoPayoutEnabled',
  'autoPayoutAddress',
  'autoPayoutAmount',
  'ipCheckEnabled',
];

const nullableAmount = <T>(
  value: string | null | undefined,
  convert: (text: string) => T,
): T | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  return convert(value);
};

const volumeKey = (
  merchantId: string,
  kind: TransactionKind,
  method: string,
): string => `${merchantId}:${kind}:${method}`;

const methodsIn = (kind: TransactionKind) =>
  REGISTRY.filter((method) => method.directions.includes(kind));

type SortKey = string | number | Decimal;

interface Keyed {
  key: SortKey;
  tiebreak: string;
}

interface SortableRow extends Keyed {
  row: MerchantListRowDto;
}

const compareKeys = (one: SortKey, other: SortKey): number => {
  if (one instanceof Decimal && other instanceof Decimal) {
    return one.comparedTo(other);
  }
  if (typeof one === 'number' && typeof other === 'number') {
    return one - other;
  }

  return one < other ? -1 : one > other ? 1 : 0;
};

@ApiTags('Admin · Merchants')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/merchants')
export class AdminMerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly methods: MerchantMethodsService,
    private readonly attachments: MerchantAttachmentsService,
    private readonly settings: MerchantSettingsService,
    private readonly currencies: MerchantCurrenciesService,
    private readonly balances: MerchantBalanceService,
    private readonly volumes: MerchantVolumeService,
    private readonly stats: MerchantStatsService,
    private readonly rates: RateService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Lists merchants as groups with their merchants and merchants without a group; a group is one row of the page',
  })
  @ApiPagedResponse(MerchantListRowDto)
  async list(
    @Query() query: ListMerchantsQueryDto,
  ): Promise<Page<MerchantListRowDto>> {
    const period = this.volumePeriodOf(query);
    const nodes = await this.merchants.listTree(query);
    const members = nodes.flatMap((node) =>
      node.kind === 'group' ? node.members : [node.merchant],
    );
    const rows = await this.rowsOf(members, period);
    const direction = query.sortOrder === SortOrder.Asc ? 1 : -1;
    const byKey = (one: Keyed, other: Keyed): number =>
      direction * compareKeys(one.key, other.key) ||
      direction * compareKeys(one.tiebreak, other.tiebreak);
    const merchantKey = (merchant: MerchantRowDto): SortKey => {
      switch (query.sortBy) {
        case MerchantSortField.Id:
          return merchant.id;
        case MerchantSortField.Name:
          return merchant.name;
        case MerchantSortField.Balance:
          return toDecimal(merchant.balance);
        default:
          return merchant.createdAt.getTime();
      }
    };

    const sortable = nodes.map((node) =>
      node.kind === 'merchant'
        ? this.merchantEntry(rows, node.merchant, merchantKey)
        : this.groupEntry(rows, node, query.sortBy, merchantKey, byKey),
    );
    sortable.sort(byKey);

    const start = (query.page - 1) * query.limit;

    return new Page(
      sortable.slice(start, start + query.limit).map((entry) => entry.row),
      {
        total: sortable.length,
        page: query.page,
        limit: query.limit,
        pages: Math.ceil(sortable.length / query.limit),
      },
    );
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Reads one merchant for its page: the row fields, group, currencies with markups, settings, escrow and the 7-day pay-in KPIs',
  })
  @ApiEnvelopeResponse(MerchantCardDto)
  async card(@Param('id', ParseUUIDPipe) id: string): Promise<MerchantCardDto> {
    const merchant = await this.merchants.findWithGroup(id);

    if (!merchant) throw new NotFoundException(MERCHANT_NOT_FOUND);

    const window = this.kpiWindow();
    const [rows, settings, currencies, states, stats] = await Promise.all([
      this.rowsOf([merchant], this.volumePeriodOf({})),
      this.settings.settingsOf(id),
      this.currencies.currenciesByMerchant([id]),
      this.balances.statesByMerchant([id]),
      this.stats.payInStats(id, window.from, window.to),
    ]);
    const kpi: MerchantKpiDto = {
      from: window.from,
      to: window.to,
      conversion: {
        successful: stats.successful,
        total: stats.total,
        percent: stats.total
          ? toDecimal(stats.successful)
              .times(100)
              .dividedBy(stats.total)
              .toDecimalPlaces(2)
              .toNumber()
          : 0,
      },
      turnover: {
        amount: formatCrypto(stats.turnover),
        count: stats.turnoverCount,
      },
    };

    return {
      ...(rows.get(id) as MerchantRowDto),
      group: merchant.group
        ? { id: merchant.group.id, name: merchant.group.name }
        : null,
      escrow: formatCrypto(states.get(id)?.escrow ?? roundCrypto(toDecimal(0))),
      currencies: (currencies.get(id) ?? []).map(toMerchantCurrencyDto),
      settings: toMerchantSettingsDto(settings),
      kpi,
      updatedAt: merchant.updatedAt,
    };
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Edits a merchant: name, internal name, group, status, the «Искл. залив» flag, currencies and the default currency',
  })
  @ApiEnvelopeResponse(MerchantRowDto)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMerchantDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantRowDto> {
    if (
      dto.name === undefined &&
      dto.internalName === undefined &&
      dto.groupId === undefined &&
      dto.active === undefined &&
      dto.exclusiveTopUp === undefined &&
      dto.currencyIds === undefined &&
      dto.defaultCurrencyId === undefined
    ) {
      throw new BadRequestException('No changes were given');
    }

    const merchant = await this.merchants.update(
      id,
      {
        ...dto,
        ...(dto.internalName !== undefined
          ? { internalName: dto.internalName || null }
          : {}),
      },
      admin.id,
    );

    return (await this.rowsOf([merchant], this.volumePeriodOf({}))).get(
      id,
    ) as MerchantRowDto;
  }

  @Put(':id/methods')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Replaces which methods the merchant has switched on, per direction; a method left out is off',
  })
  @ApiEnvelopeResponse(MerchantMethodStateDto, { isArray: true })
  replaceMethods(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceMerchantMethodsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantMethodStateDto[]> {
    return this.methods.replace(id, dto.methods, admin.id);
  }

  @Put(':id/markups')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Replaces the rate markups per currency and direction; only the merchant’s currencies, a currency left out gets zero',
  })
  @ApiEnvelopeResponse(MerchantCurrencyDto, { isArray: true })
  async replaceMarkups(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceMerchantMarkupsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantCurrencyDto[]> {
    return (
      await this.currencies.replaceMarkups(id, dto.markups, admin.id)
    ).map(toMerchantCurrencyDto);
  }

  @Patch(':id/settings')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Edits the merchant’s settings; overdraft, auto payout and IP checking are a superadmin’s to change',
  })
  @ApiEnvelopeResponse(MerchantSettingsDto)
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMerchantSettingsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MerchantSettingsDto> {
    const reserved = SUPERADMIN_SETTINGS.filter(
      (key) => dto[key] !== undefined,
    );

    if (admin.role !== Role.Superadmin && reserved.length) {
      throw new ForbiddenException(
        `Only a superadmin changes ${reserved.join(', ')}`,
      );
    }

    if (
      dto.autoPayoutAddress !== undefined &&
      dto.autoPayoutAddress !== null &&
      !isTronAddress(dto.autoPayoutAddress)
    ) {
      throw new BadRequestException(
        'autoPayoutAddress must be a TRC-20 address',
      );
    }

    return toMerchantSettingsDto(
      await this.settings.update(
        id,
        {
          ...dto,
          minPayInAmount: nullableAmount(dto.minPayInAmount, toFiat),
          autoPayoutAmount: nullableAmount(dto.autoPayoutAmount, toCrypto),
          withdrawalFee:
            dto.withdrawalFee === undefined
              ? undefined
              : toCrypto(dto.withdrawalFee),
        },
        admin.id,
      ),
    );
  }

  private kpiWindow(): { from: Date; to: Date } {
    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
    const today = calendarDateIn(new Date(), timeZone);

    return {
      from: zonedMidnight(
        addCalendarDays(today, 1 - KPI_WINDOW_DAYS),
        timeZone,
      ),
      to: zonedMidnight(addCalendarDays(today, 1), timeZone),
    };
  }

  private merchantEntry(
    rows: Map<string, MerchantRowDto>,
    merchant: Merchant,
    merchantKey: (row: MerchantRowDto) => SortKey,
  ): SortableRow {
    const row = rows.get(merchant.id) as MerchantRowDto;

    return {
      row: { kind: 'merchant', group: null, merchant: row },
      key: merchantKey(row),
      tiebreak: row.id,
    };
  }

  private groupEntry(
    rows: Map<string, MerchantRowDto>,
    node: Extract<MerchantTreeNode, { kind: 'group' }>,
    sortBy: MerchantSortField,
    merchantKey: (row: MerchantRowDto) => SortKey,
    byKey: (one: Keyed, other: Keyed) => number,
  ): SortableRow {
    const memberRows = node.members.map(
      (member) => rows.get(member.id) as MerchantRowDto,
    );
    const shownRows = node.shown
      .map((member) => rows.get(member.id) as MerchantRowDto)
      .map((row) => ({ row, key: merchantKey(row), tiebreak: row.id }))
      .sort(byKey)
      .map((entry) => entry.row);
    const balance = roundCrypto(
      memberRows.reduce(
        (sum, member) => sum.plus(toDecimal(member.balance)),
        toDecimal(0),
      ),
    );
    const anyOn =
      (chips: (row: MerchantRowDto) => MerchantMethodChipDto[]) =>
      (method: string): boolean =>
        memberRows.some((member) =>
          chips(member).some((chip) => chip.method === method && chip.enabled),
        );
    const volumeOf =
      (chips: (row: MerchantRowDto) => MerchantMethodChipDto[]) =>
      (method: string): string =>
        formatFiat(
          roundFiat(
            memberRows.reduce(
              (sum, member) =>
                sum.plus(
                  chips(member).find((chip) => chip.method === method)
                    ?.volume ?? 0,
                ),
              toDecimal(0),
            ),
          ),
        );
    const groupChips = (
      kind: TransactionKind,
      chips: (row: MerchantRowDto) => MerchantMethodChipDto[],
    ): MerchantMethodChipDto[] =>
      methodsIn(kind).map(({ code }) => ({
        method: code,
        enabled: anyOn(chips)(code),
        percent: null,
        volume: volumeOf(chips)(code),
      }));
    const group: MerchantGroupRowDto = {
      id: node.group.id,
      name: node.group.name,
      active: memberRows.some((member) => member.active),
      exclusiveTopUp: memberRows.some((member) => member.exclusiveTopUp),
      balance: formatCrypto(balance),
      methods: {
        payIn: groupChips(TransactionKind.PayIn, (row) => row.methods.payIn),
        payOut: groupChips(TransactionKind.PayOut, (row) => row.methods.payOut),
      },
      merchants: shownRows,
      createdAt: node.group.createdAt,
    };
    const key: SortKey =
      sortBy === MerchantSortField.Name
        ? group.name
        : sortBy === MerchantSortField.Balance
          ? balance
          : sortBy === MerchantSortField.Id
            ? shownRows.map((row) => row.id).sort()[0]
            : group.createdAt.getTime();

    return {
      row: { kind: 'group', group, merchant: null },
      key,
      tiebreak: String(group.id),
    };
  }

  private volumePeriodOf(query: {
    period?: MerchantVolumePeriod;
    periodFrom?: string;
    periodTo?: string;
  }): { from: Date; to: Date } {
    const custom =
      query.periodFrom !== undefined || query.periodTo !== undefined;

    if (custom && query.period !== undefined) {
      throw new BadRequestException(
        'period and periodFrom/periodTo cannot be used together',
      );
    }

    if (
      custom &&
      (query.periodFrom === undefined || query.periodTo === undefined)
    ) {
      throw new BadRequestException(
        'periodFrom and periodTo are given together',
      );
    }

    const timeZone = this.config.getOrThrow<string>('BUSINESS_TIMEZONE');
    const today = calendarDateIn(new Date(), timeZone);
    const tomorrow = addCalendarDays(today, 1);
    const [first, afterLast] = custom
      ? [
          query.periodFrom as string,
          addCalendarDays(query.periodTo as string, 1),
        ]
      : {
          [MerchantVolumePeriod.Today]: [today, tomorrow],
          [MerchantVolumePeriod.Yesterday]: [addCalendarDays(today, -1), today],
          [MerchantVolumePeriod.Last7Days]: [
            addCalendarDays(today, -6),
            tomorrow,
          ],
          [MerchantVolumePeriod.Month]: [`${today.slice(0, 8)}01`, tomorrow],
        }[query.period ?? MerchantVolumePeriod.Today];

    return {
      from: zonedMidnight(first, timeZone),
      to: zonedMidnight(afterLast, timeZone),
    };
  }

  private async rowsOf(
    merchants: Merchant[],
    period: { from: Date; to: Date },
  ): Promise<Map<string, MerchantRowDto>> {
    const ids = merchants.map((merchant) => merchant.id);
    const [balances, states, rates, counts, volumes] = await Promise.all([
      this.balances.balancesByMerchant(ids),
      this.methods.statesByMerchant(ids),
      ids.length
        ? this.rates.getEffectiveMerchantGeneralRates(ids)
        : Promise.resolve({
            base: [],
            bySubject: new Map<string, MethodPercent[]>(),
          }),
      this.attachments.countsByMerchant(ids),
      this.volumes.volumesByMerchant(ids, period.from, period.to),
    ]);
    const volumeBy = new Map<string, Fiat>(
      volumes.map((entry) => [
        volumeKey(entry.merchantId, entry.kind, entry.method),
        entry.volume,
      ]),
    );

    return new Map(
      merchants.map((merchant) => [
        merchant.id,
        {
          id: merchant.id,
          name: merchant.name,
          internalName: merchant.internalName,
          groupId: merchant.groupId,
          active: merchant.active,
          exclusiveTopUp: merchant.exclusiveTopUp,
          balance: formatCrypto(
            balances.get(merchant.id) ?? roundCrypto(toDecimal(0)),
          ),
          methods: this.chipsOf(
            states.get(merchant.id) ?? [],
            rates.bySubject.get(merchant.id) ?? [],
            (kind, method) =>
              volumeBy.get(volumeKey(merchant.id, kind, method)) ?? null,
          ),
          attachments: counts.get(merchant.id) ?? { traders: 0, cascades: 0 },
          createdAt: merchant.createdAt,
        },
      ]),
    );
  }

  private chipsOf(
    states: MerchantMethodState[],
    percents: MethodPercent[],
    volumeOf: (kind: TransactionKind, method: string) => Fiat | null,
  ): MerchantMethodsDto {
    const state = new Map(states.map((entry) => [entry.method, entry]));
    const percent = new Map<string, MethodPercent>(
      percents.map((entry) => [entry.method, entry]),
    );

    return {
      payIn: methodsIn(TransactionKind.PayIn).map(({ code }) => ({
        method: code,
        enabled: state.get(code)?.payInEnabled ?? false,
        percent: percent.get(code)?.payInPercent ?? null,
        volume: formatFiat(
          volumeOf(TransactionKind.PayIn, code) ?? roundFiat(toDecimal(0)),
        ),
      })),
      payOut: methodsIn(TransactionKind.PayOut).map(({ code }) => ({
        method: code,
        enabled: state.get(code)?.payOutEnabled ?? false,
        percent: percent.get(code)?.payOutPercent ?? null,
        volume: formatFiat(
          volumeOf(TransactionKind.PayOut, code) ?? roundFiat(toDecimal(0)),
        ),
      })),
    };
  }
}

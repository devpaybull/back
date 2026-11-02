import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BanksService } from '../../banks/banks.service';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { formatFiat } from '../../common/utils/format-fiat';
import { MerchantCurrenciesService } from '../../merchants/services/merchant-currencies.service';
import { MerchantMethodsService } from '../../merchants/services/merchant-methods.service';
import { RateService } from '../../transactions/services/rate.service';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { findTransactionMethod } from '../../transactions/utils/find-transaction-method';
import { CurrentMerchant } from '../decorators/current-merchant.decorator';
import { MerchantCurrencyRatesDto } from '../dto/merchant-rates.dto';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';

@ApiTags('Merchant · Rates')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard, MerchantScopeGuard)
@Roles(Role.Merchant, Role.MerchantSupport, Role.MerchantAgent)
@Controller('merchant/rates')
export class MerchantRatesController {
  constructor(
    private readonly rates: RateService,
    private readonly currencies: MerchantCurrenciesService,
    private readonly methods: MerchantMethodsService,
    private readonly banks: BanksService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'The merchant’s rates in force, per currency of the merchant and per switched-on method',
    description:
      'The individual set where one exists, else the base merchant rate; amount bands and bank rows included. A method switched off, or with no rate, is left out; markups on the exchange rate are not here.',
  })
  @ApiEnvelopeResponse(MerchantCurrencyRatesDto, { isArray: true })
  async list(
    @CurrentMerchant() merchantId: string,
  ): Promise<MerchantCurrencyRatesDto[]> {
    const [set, currencies, switches] = await Promise.all([
      this.rates.getEffectiveMerchantSet(merchantId),
      this.currencies.currenciesByMerchant([merchantId]),
      this.methods.statesByMerchant([merchantId]),
    ]);
    const switchByMethod = new Map(
      (switches.get(merchantId) ?? []).map((state) => [state.method, state]),
    );
    const banks = new Map(
      (
        await this.banks.findByIds([
          ...new Set(
            set.flatMap((entry) => entry.banks.map((row) => row.bankId)),
          ),
        ])
      ).map((bank) => [bank.id, { id: bank.id, name: bank.name }]),
    );

    return (currencies.get(merchantId) ?? []).map((currency) => ({
      currencyId: currency.currencyId,
      isocode: currency.currency.isocode,
      methods: set.flatMap((entry) => {
        const definition = findTransactionMethod(entry.method);
        const state = switchByMethod.get(entry.method);

        if (definition?.currency !== currency.currency.isocode) return [];

        const enabled = {
          payIn:
            Boolean(state?.payInEnabled) &&
            definition.directions.includes(TransactionKind.PayIn),
          payOut:
            Boolean(state?.payOutEnabled) &&
            definition.directions.includes(TransactionKind.PayOut),
        };

        if (!enabled.payIn && !enabled.payOut) return [];

        const rows = [
          ...(entry.general
            ? [
                {
                  ...entry.general,
                  fromAmount: null,
                  toAmount: null,
                  bank: null,
                },
              ]
            : []),
          ...entry.bands.map((band) => ({
            payInPercent: band.payInPercent,
            payOutPercent: band.payOutPercent,
            fromAmount: formatFiat(band.fromAmount),
            toAmount: formatFiat(band.toAmount),
            bank: null,
          })),
          ...entry.banks.map((row) => ({
            payInPercent: row.payInPercent,
            payOutPercent: row.payOutPercent,
            fromAmount: null,
            toAmount: null,
            bank: banks.get(row.bankId) ?? null,
          })),
        ];

        return rows.length
          ? [{ method: entry.method, enabled, rates: rows }]
          : [];
      }),
    }));
  }
}

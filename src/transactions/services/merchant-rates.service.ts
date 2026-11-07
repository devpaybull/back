import { Injectable } from '@nestjs/common';
import { BanksService } from '../../banks/banks.service';
import { formatFiat } from '../../common/utils/format-fiat';
import { MerchantCurrenciesService } from '../../merchants/services/merchant-currencies.service';
import { MerchantMethodsService } from '../../merchants/services/merchant-methods.service';
import { MerchantCurrencyRatesDto } from '../dto/merchant-rates.dto';
import { MerchantExchangeRate } from '../types/merchant-exchange-rate';
import { TransactionKind } from '../types/transaction-kind.enum';
import { findTransactionMethod } from '../utils/find-transaction-method';
import { RAPIRA_CURRENCY } from '../utils/rapira-currency';
import { RateService } from './rate.service';

@Injectable()
export class MerchantRatesService {
  constructor(
    private readonly rates: RateService,
    private readonly currencies: MerchantCurrenciesService,
    private readonly methods: MerchantMethodsService,
    private readonly banks: BanksService,
  ) {}

  async inForce(merchantId: string): Promise<MerchantCurrencyRatesDto[]> {
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

  async exchangeRates(merchantId: string): Promise<MerchantExchangeRate[]> {
    const currencies = (
      (await this.currencies.currenciesByMerchant([merchantId])).get(
        merchantId,
      ) ?? []
    ).filter((row) => row.currency.isocode === RAPIRA_CURRENCY);
    const rates: MerchantExchangeRate[] = [];

    for (const row of currencies) {
      rates.push(
        {
          currency: row.currency.isocode,
          type: TransactionKind.PayIn,
          rate: await this.rates.merchantSourceRate(row.payInMarkupPercent),
        },
        {
          currency: row.currency.isocode,
          type: TransactionKind.PayOut,
          rate: await this.rates.merchantSourceRate(row.payOutMarkupPercent),
        },
      );
    }

    return rates;
  }
}

import { ServiceUnavailableException } from '@nestjs/common';
import { formatRate } from '../../common/utils/format-rate';
import { roundRate } from '../../common/utils/round-rate';
import { toDecimal } from '../../common/utils/to-decimal';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toFiat } from '../../common/utils/to-fiat';
import { MerchantRatesService } from '../services/merchant-rates.service';

const MERCHANT = uuidOf(30);

describe('MerchantRatesService', () => {
  const build = (switches: object[]) => {
    const rates = {
      getEffectiveMerchantSet: jest.fn(async () => [
        {
          method: 'sbp',
          general: { payInPercent: 7, payOutPercent: 2 },
          bands: [
            {
              fromAmount: toFiat(1000),
              toAmount: toFiat(50000),
              payInPercent: 6.5,
              payOutPercent: 1.5,
            },
          ],
          banks: [],
        },
        {
          method: 'counterparty',
          general: { payInPercent: 8, payOutPercent: 0 },
          bands: [],
          banks: [{ bankId: 4, payInPercent: 7.5, payOutPercent: 0 }],
        },
        {
          method: 'mobile_commerce',
          general: { payInPercent: 9, payOutPercent: 0 },
          bands: [],
          banks: [],
        },
      ]),
    };
    const currencies = {
      currenciesByMerchant: jest.fn(
        async () =>
          new Map([
            [
              MERCHANT,
              [
                { currencyId: 1, currency: { isocode: 'RUB' } },
                { currencyId: 2, currency: { isocode: 'USD' } },
              ],
            ],
          ]),
      ),
    };
    const methods = {
      statesByMerchant: jest.fn(async () => new Map([[MERCHANT, switches]])),
    };
    const banks = {
      findByIds: jest.fn(async () => [{ id: 4, name: 'Т-банк' }]),
    };

    return new MerchantRatesService(
      rates as never,
      currencies as never,
      methods as never,
      banks as never,
    );
  };

  it('shows the switched-on methods per currency with bands and banks, hides the rest', async () => {
    const service = build([
      { method: 'sbp', payInEnabled: true, payOutEnabled: false },
      { method: 'counterparty', payInEnabled: true, payOutEnabled: true },
      { method: 'mobile_commerce', payInEnabled: false, payOutEnabled: false },
    ]);

    expect(await service.inForce(MERCHANT)).toEqual([
      {
        currencyId: 1,
        isocode: 'RUB',
        methods: [
          {
            method: 'sbp',
            enabled: { payIn: true, payOut: false },
            rates: [
              {
                payInPercent: 7,
                payOutPercent: 2,
                fromAmount: null,
                toAmount: null,
                bank: null,
              },
              {
                payInPercent: 6.5,
                payOutPercent: 1.5,
                fromAmount: '1000.00',
                toAmount: '50000.00',
                bank: null,
              },
            ],
          },
          {
            method: 'counterparty',
            enabled: { payIn: true, payOut: false },
            rates: [
              {
                payInPercent: 8,
                payOutPercent: 0,
                fromAmount: null,
                toAmount: null,
                bank: null,
              },
              {
                payInPercent: 7.5,
                payOutPercent: 0,
                fromAmount: null,
                toAmount: null,
                bank: { id: 4, name: 'Т-банк' },
              },
            ],
          },
        ],
      },
      { currencyId: 2, isocode: 'USD', methods: [] },
    ]);
  });

  it('answers nothing for a merchant with no switched-on method', async () => {
    const [rub] = await build([]).inForce(MERCHANT);

    expect(rub.methods).toEqual([]);
  });
});

describe('MerchantRatesService.exchangeRates', () => {
  const build = (fiatPerUsdt: Promise<string>) => {
    const rates = {
      merchantSourceRates: jest.fn(async (markups: number[]) => {
        const source = toDecimal(await fiatPerUsdt).times(1.01);

        return markups.map((markup) =>
          roundRate(source.times(toDecimal(markup).div(100).plus(1))),
        );
      }),
    };
    const currencies = {
      currenciesByMerchant: jest.fn(
        async () =>
          new Map([
            [
              MERCHANT,
              [
                {
                  currencyId: 1,
                  currency: { isocode: 'RUB' },
                  payInMarkupPercent: 2,
                  payOutMarkupPercent: -1.5,
                },
                {
                  currencyId: 2,
                  currency: { isocode: 'KZT' },
                  payInMarkupPercent: 0,
                  payOutMarkupPercent: 0,
                },
              ],
            ],
          ]),
      ),
    };

    return {
      rates,
      service: new MerchantRatesService(
        rates as never,
        currencies as never,
        {} as never,
        {} as never,
      ),
    };
  };

  it('prices each direction of a RUB currency with its own markup, positive or negative', async () => {
    const { service, rates } = build(Promise.resolve('90'));
    const answer = await service.exchangeRates(MERCHANT);

    expect(
      answer.map((row) => ({ ...row, rate: formatRate(row.rate) })),
    ).toEqual([
      { currency: 'RUB', type: 'pay_in', rate: '92.718000' },
      { currency: 'RUB', type: 'pay_out', rate: '89.536500' },
    ]);
    expect(rates.merchantSourceRates.mock.calls).toEqual([[[2, -1.5]]]);
  });

  it('leaves out a currency the rate source does not price', async () => {
    const { service } = build(Promise.resolve('90'));

    expect(
      (await service.exchangeRates(MERCHANT)).map((row) => row.currency),
    ).not.toContain('KZT');
  });

  it('passes the source failure through when no rate was ever fetched', async () => {
    const { service } = build(
      Promise.reject(new ServiceUnavailableException('down')),
    );

    await expect(service.exchangeRates(MERCHANT)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

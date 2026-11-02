import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toFiat } from '../../common/utils/to-fiat';
import { MerchantRatesController } from '../controllers/merchant-rates.controller';

const MERCHANT = uuidOf(30);

describe('MerchantRatesController', () => {
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

    return new MerchantRatesController(
      rates as never,
      currencies as never,
      methods as never,
      banks as never,
    );
  };

  it('shows the switched-on methods per currency with bands and banks, hides the rest', async () => {
    const controller = build([
      { method: 'sbp', payInEnabled: true, payOutEnabled: false },
      { method: 'counterparty', payInEnabled: true, payOutEnabled: true },
      { method: 'mobile_commerce', payInEnabled: false, payOutEnabled: false },
    ]);

    expect(await controller.list(MERCHANT)).toEqual([
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
    const [rub] = await build([]).list(MERCHANT);

    expect(rub.methods).toEqual([]);
  });
});

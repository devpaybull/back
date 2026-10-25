import { toCrypto } from '../../common/utils/to-crypto';
import { RateSetDto } from '../dto/rate-set.dto';
import { toSubjectMethodRates } from '../utils/to-subject-method-rates';

describe('toSubjectMethodRates', () => {
  it('turns the band bounds into exact decimals and keeps the percents', () => {
    const dto = {
      methods: [
        {
          method: 'sbp',
          general: { payInPercent: 2, payOutPercent: 1 },
          bands: [
            {
              fromAmount: '1000.000001',
              toAmount: '5000',
              payInPercent: 1.5,
              payOutPercent: 0.5,
            },
          ],
          banks: [{ bankId: 7, payInPercent: 3, payOutPercent: 2 }],
        },
      ],
    } as RateSetDto;

    expect(toSubjectMethodRates(dto)).toEqual([
      {
        method: 'sbp',
        general: { payInPercent: 2, payOutPercent: 1 },
        bands: [
          {
            fromAmount: toCrypto('1000.000001'),
            toAmount: toCrypto(5000),
            payInPercent: 1.5,
            payOutPercent: 0.5,
          },
        ],
        banks: [{ bankId: 7, payInPercent: 3, payOutPercent: 2 }],
      },
    ]);
  });

  it('treats absent lists as empty and an absent general rate as null', () => {
    const dto = { methods: [{ method: 'card' }] } as RateSetDto;

    expect(toSubjectMethodRates(dto)).toEqual([
      { method: 'card', general: null, bands: [], banks: [] },
    ]);
  });
});

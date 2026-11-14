import { rateSummariesOf } from '../utils/rate-summaries-of';

describe('rateSummariesOf', () => {
  it('answers nothing for nothing', () => {
    expect(rateSummariesOf([])).toEqual([]);
  });

  it('spans the lowest and highest percent of each direction on its own', () => {
    expect(
      rateSummariesOf([
        { currency: 'RUB', payInPercent: 14, payOutPercent: 0 },
        { currency: 'RUB', payInPercent: 0, payOutPercent: 2.5 },
        { currency: 'RUB', payInPercent: 7, payOutPercent: 1 },
      ]),
    ).toEqual([
      {
        currency: 'RUB',
        payIn: { min: 0, max: 14 },
        payOut: { min: 0, max: 2.5 },
      },
    ]);
  });

  it('keeps currencies apart and orders them by code', () => {
    expect(
      rateSummariesOf([
        { currency: 'RUB', payInPercent: 5, payOutPercent: 1 },
        { currency: 'KZT', payInPercent: 3, payOutPercent: 2 },
      ]).map((summary) => summary.currency),
    ).toEqual(['KZT', 'RUB']);
  });

  it('does not change the entries it was given', () => {
    const entries = [{ currency: 'RUB', payInPercent: 5, payOutPercent: 1 }];

    rateSummariesOf(entries);

    expect(entries).toEqual([
      { currency: 'RUB', payInPercent: 5, payOutPercent: 1 },
    ]);
  });
});

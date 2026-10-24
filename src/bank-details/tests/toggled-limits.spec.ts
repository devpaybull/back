import { BankDetailsLimits } from '../types/bank-details-limits';
import { toggledLimits } from '../utils/toggled-limits';

describe('toggledLimits', () => {
  const pairs: [keyof BankDetailsLimits, keyof BankDetailsLimits][] = [
    ['minAmountEnabled', 'minAmount'],
    ['maxAmountEnabled', 'maxAmount'],
    ['dailyLimitEnabled', 'dailyLimit'],
    ['monthlyLimitEnabled', 'monthlyLimit'],
    ['dailyAmountLimitEnabled', 'dailyAmountLimit'],
    ['monthlyAmountLimitEnabled', 'monthlyAmountLimit'],
    ['maxActiveTransactionsEnabled', 'maxActiveTransactions'],
    ['delayBetweenRequestsEnabled', 'delayBetweenRequests'],
  ];

  it('starts every pair off and empty', () => {
    const settled = toggledLimits({}, {});

    for (const [toggle, value] of pairs) {
      expect(settled[toggle]).toBe(false);
      expect(settled[value]).toBeNull();
    }
  });

  it.each(pairs)('keeps %s beside the value it enables', (toggle, value) => {
    expect(toggledLimits({}, { [toggle]: true, [value]: 7 })).toMatchObject({
      [toggle]: true,
      [value]: 7,
    });
  });

  it.each(pairs)('nulls %s when the toggle stays off', (toggle, value) => {
    expect(toggledLimits({}, { [value]: 7 })).toMatchObject({
      [toggle]: false,
      [value]: null,
    });
  });

  it.each(pairs)(
    'nulls %s when the toggle is switched off',
    (toggle, value) => {
      expect(
        toggledLimits({ [toggle]: true, [value]: 7 }, { [toggle]: false }),
      ).toMatchObject({ [toggle]: false, [value]: null });
    },
  );

  it.each(pairs)(
    'carries a standing %s through an unrelated change',
    (toggle, value) => {
      expect(toggledLimits({ [toggle]: true, [value]: 7 }, {})).toMatchObject({
        [toggle]: true,
        [value]: 7,
      });
    },
  );

  it.each(pairs)('takes a new value for a standing %s', (toggle, value) => {
    expect(
      toggledLimits({ [toggle]: true, [value]: 7 }, { [value]: 9 }),
    ).toMatchObject({ [toggle]: true, [value]: 9 });
  });

  it.each(pairs)(
    'leaves %s empty when the toggle arrives without a value',
    (toggle, value) => {
      expect(toggledLimits({}, { [toggle]: true })).toMatchObject({
        [toggle]: true,
        [value]: null,
      });
    },
  );

  it('takes zero as a real value rather than an absent one', () => {
    expect(
      toggledLimits({}, { dailyLimitEnabled: true, dailyLimit: 0 }),
    ).toMatchObject({ dailyLimitEnabled: true, dailyLimit: 0 });
  });

  describe('counterpartyOnly forces the minimum', () => {
    it('switches the minimum on and holds no number, since the floor is configured', () => {
      expect(toggledLimits({}, { counterpartyOnly: true })).toMatchObject({
        minAmountEnabled: true,
        minAmount: null,
      });
    });

    it('discards a minimum the trader already had', () => {
      expect(
        toggledLimits(
          { minAmountEnabled: true, minAmount: 700 },
          { counterpartyOnly: true },
        ),
      ).toMatchObject({ minAmountEnabled: true, minAmount: null });
    });

    it('keeps forcing it while the flag stands, with no flag in the changes', () => {
      expect(toggledLimits({ counterpartyOnly: true }, {})).toMatchObject({
        minAmountEnabled: true,
        minAmount: null,
      });
    });

    it('puts the minimum out when the flag is switched off', () => {
      expect(
        toggledLimits(
          { counterpartyOnly: true, minAmountEnabled: true },
          { counterpartyOnly: false },
        ),
      ).toMatchObject({ minAmountEnabled: false, minAmount: null });
    });

    it('does not touch a minimum on a row that was never counterparty-only', () => {
      expect(
        toggledLimits(
          { minAmountEnabled: true, minAmount: 700 },
          { counterpartyOnly: false },
        ),
      ).toMatchObject({ minAmountEnabled: true, minAmount: 700 });
    });

    it('leaves the other seven pairs to the ordinary rules', () => {
      expect(
        toggledLimits(
          {},
          {
            counterpartyOnly: true,
            maxAmountEnabled: true,
            maxAmount: 100000,
            dailyLimit: 40,
          },
        ),
      ).toMatchObject({
        maxAmountEnabled: true,
        maxAmount: 100000,
        dailyLimitEnabled: false,
        dailyLimit: null,
      });
    });
  });

  it('settles each pair on its own', () => {
    const settled = toggledLimits(
      { maxAmountEnabled: true, maxAmount: 100000 },
      { minAmountEnabled: true, minAmount: 500, dailyLimit: 40 },
    );

    expect(settled).toMatchObject({
      minAmountEnabled: true,
      minAmount: 500,
      maxAmountEnabled: true,
      maxAmount: 100000,
      dailyLimitEnabled: false,
      dailyLimit: null,
    });
  });
});

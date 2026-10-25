import { BankDetailsLimits } from '../types/bank-details-limits';

const settled = <T>(enabled: boolean, value: T): [boolean, T | null] =>
  enabled ? [true, value ?? null] : [false, null];

export const toggledLimits = (
  current: Partial<BankDetailsLimits> & { counterpartyOnly?: boolean },
  changes: Partial<BankDetailsLimits> & { counterpartyOnly?: boolean },
): BankDetailsLimits => {
  const counterpartyOnly =
    changes.counterpartyOnly ?? current.counterpartyOnly ?? false;

  const releasedFromCounterparty =
    !counterpartyOnly && Boolean(current.counterpartyOnly);

  const [minAmountEnabled, minAmount] =
    counterpartyOnly || releasedFromCounterparty
      ? settled(counterpartyOnly, null)
      : settled(
          changes.minAmountEnabled ?? current.minAmountEnabled ?? false,
          changes.minAmount ?? current.minAmount,
        );

  const [maxAmountEnabled, maxAmount] = settled(
    changes.maxAmountEnabled ?? current.maxAmountEnabled ?? false,
    changes.maxAmount ?? current.maxAmount,
  );

  const [dailyLimitEnabled, dailyLimit] = settled(
    changes.dailyLimitEnabled ?? current.dailyLimitEnabled ?? false,
    changes.dailyLimit ?? current.dailyLimit,
  );

  const [monthlyLimitEnabled, monthlyLimit] = settled(
    changes.monthlyLimitEnabled ?? current.monthlyLimitEnabled ?? false,
    changes.monthlyLimit ?? current.monthlyLimit,
  );

  const [dailyAmountLimitEnabled, dailyAmountLimit] = settled(
    changes.dailyAmountLimitEnabled ?? current.dailyAmountLimitEnabled ?? false,
    changes.dailyAmountLimit ?? current.dailyAmountLimit,
  );

  const [monthlyAmountLimitEnabled, monthlyAmountLimit] = settled(
    changes.monthlyAmountLimitEnabled ??
      current.monthlyAmountLimitEnabled ??
      false,
    changes.monthlyAmountLimit ?? current.monthlyAmountLimit,
  );

  const [maxActiveTransactionsEnabled, maxActiveTransactions] = settled(
    changes.maxActiveTransactionsEnabled ??
      current.maxActiveTransactionsEnabled ??
      false,
    changes.maxActiveTransactions ?? current.maxActiveTransactions,
  );

  const [delayBetweenRequestsEnabled, delayBetweenRequests] = settled(
    changes.delayBetweenRequestsEnabled ??
      current.delayBetweenRequestsEnabled ??
      false,
    changes.delayBetweenRequests ?? current.delayBetweenRequests,
  );

  return {
    minAmountEnabled,
    minAmount,
    maxAmountEnabled,
    maxAmount,
    dailyLimitEnabled,
    dailyLimit,
    monthlyLimitEnabled,
    monthlyLimit,
    dailyAmountLimitEnabled,
    dailyAmountLimit,
    monthlyAmountLimitEnabled,
    monthlyAmountLimit,
    maxActiveTransactionsEnabled,
    maxActiveTransactions,
    delayBetweenRequestsEnabled,
    delayBetweenRequests,
  };
};

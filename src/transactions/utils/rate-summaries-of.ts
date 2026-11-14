import { CurrencyPercent } from '../types/currency-percent';
import { RateSummary } from '../types/rate-summary';

export const rateSummariesOf = (
  entries: readonly CurrencyPercent[],
): RateSummary[] => {
  const byCurrency = new Map<string, RateSummary>();

  for (const { currency, payInPercent, payOutPercent } of entries) {
    const summary = byCurrency.get(currency);

    if (!summary) {
      byCurrency.set(currency, {
        currency,
        payIn: { min: payInPercent, max: payInPercent },
        payOut: { min: payOutPercent, max: payOutPercent },
      });
      continue;
    }

    summary.payIn.min = Math.min(summary.payIn.min, payInPercent);
    summary.payIn.max = Math.max(summary.payIn.max, payInPercent);
    summary.payOut.min = Math.min(summary.payOut.min, payOutPercent);
    summary.payOut.max = Math.max(summary.payOut.max, payOutPercent);
  }

  return [...byCurrency.values()].sort((one, other) =>
    one.currency < other.currency ? -1 : one.currency > other.currency ? 1 : 0,
  );
};

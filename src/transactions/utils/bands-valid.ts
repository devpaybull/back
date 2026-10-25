import { Fiat } from '../../common/types/fiat';

export const bandsAreValid = (
  bands: { fromAmount: Fiat; toAmount: Fiat }[],
): boolean => {
  for (const band of bands) {
    if (band.fromAmount.gt(band.toAmount)) return false;
  }

  const sorted = [...bands].sort((a, b) =>
    a.fromAmount.comparedTo(b.fromAmount),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].fromAmount.lte(sorted[index - 1].toAmount)) return false;
  }

  return true;
};

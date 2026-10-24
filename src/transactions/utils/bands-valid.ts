export const bandsAreValid = (
  bands: { fromAmount: number; toAmount: number }[],
): boolean => {
  for (const band of bands) {
    if (band.fromAmount > band.toAmount) return false;
  }

  const sorted = [...bands].sort((a, b) => a.fromAmount - b.fromAmount);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].fromAmount <= sorted[index - 1].toAmount) return false;
  }

  return true;
};

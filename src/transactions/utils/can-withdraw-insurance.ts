export function canWithdrawInsurance(
  lastAcceptedDealAt: Date | null,
  now: Date,
  delayDays: number,
): boolean {
  if (lastAcceptedDealAt === null) return true;

  const elapsedMs = now.getTime() - lastAcceptedDealAt.getTime();
  const delayMs = delayDays * 24 * 60 * 60 * 1000;

  return elapsedMs >= delayMs;
}

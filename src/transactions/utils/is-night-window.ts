export function isNightWindow(
  now: Date,
  startHour: number,
  endHour: number,
  timeZone: string,
): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(now),
  );

  return hour >= startHour && hour < endHour;
}

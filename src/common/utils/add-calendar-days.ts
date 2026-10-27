const pad = (value: number, width: number): string =>
  String(value).padStart(width, '0');

export function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, date + days));

  return [
    pad(moved.getUTCFullYear(), 4),
    pad(moved.getUTCMonth() + 1, 2),
    pad(moved.getUTCDate(), 2),
  ].join('-');
}

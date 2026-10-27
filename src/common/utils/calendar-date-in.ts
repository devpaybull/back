export function calendarDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string): string =>
    parts.find((entry) => entry.type === type).value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

const offsetMs = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const part = (type: string): number =>
    Number(parts.find((entry) => entry.type === type).value);
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );

  return wallClock - Math.floor(instant.getTime() / 1000) * 1000;
};

export function zonedMidnight(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  const midnightWall = Date.UTC(year, month - 1, date);
  const first = new Date(
    midnightWall - offsetMs(new Date(midnightWall), timeZone),
  );

  return new Date(midnightWall - offsetMs(first, timeZone));
}

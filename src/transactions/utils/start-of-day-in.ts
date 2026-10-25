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

export function startOfDayIn(
  now: Date,
  timeZone: string,
  dayOfMonth?: number,
): Date {
  const wall = new Date(now.getTime() + offsetMs(now, timeZone));
  const midnightWall = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    dayOfMonth ?? wall.getUTCDate(),
  );
  const first = new Date(midnightWall - offsetMs(now, timeZone));

  return new Date(midnightWall - offsetMs(first, timeZone));
}

import { toInstant } from '../utils/to-instant';

describe('toInstant', () => {
  it('reads a bare day as midnight in the given zone', () => {
    expect(toInstant('2026-10-24', 'Europe/Moscow')).toEqual(
      new Date('2026-10-23T21:00:00Z'),
    );
  });

  it('takes a date-time with its own offset as written', () => {
    expect(toInstant('2026-10-24T10:00:00+05:00', 'Europe/Moscow')).toEqual(
      new Date('2026-10-24T05:00:00Z'),
    );
  });

  it('passes an absent bound through', () => {
    expect(toInstant(undefined, 'Europe/Moscow')).toBeUndefined();
  });
});

import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsNotBelow } from '../utils/is-not-below';

class NumberRange {
  from?: number;

  @IsNotBelow('from')
  to?: number;
}

class MoneyRange {
  from?: string;

  @IsNotBelow('from')
  to?: string;
}

class DateRange {
  @Type(() => Date)
  from?: Date;

  @Type(() => Date)
  @IsNotBelow('from')
  to?: Date;
}

const errorsOf = (cls: new () => object, plain: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, plain));

describe('IsNotBelow', () => {
  it('accepts an upper bound above or equal to the lower one', () => {
    expect(errorsOf(NumberRange, { from: 1, to: 2 })).toEqual([]);
    expect(errorsOf(NumberRange, { from: 2, to: 2 })).toEqual([]);
  });

  it('refuses an upper bound below the lower one, naming both', () => {
    const [error] = errorsOf(NumberRange, { from: 3, to: 2 });

    expect(error.property).toBe('to');
    expect(error.constraints).toEqual({
      isNotBelow: 'to must not be below from',
    });
  });

  it('compares decimal strings exactly, where a float cannot tell them apart', () => {
    expect(
      errorsOf(MoneyRange, {
        from: '999999999999.999999',
        to: '999999999999.999998',
      }).map((error) => error.property),
    ).toEqual(['to']);
    expect(
      errorsOf(MoneyRange, {
        from: '999999999999.999998',
        to: '999999999999.999999',
      }),
    ).toEqual([]);
  });

  it('has nothing to compare when either bound is absent', () => {
    expect(errorsOf(NumberRange, { to: 2 })).toEqual([]);
    expect(errorsOf(NumberRange, { from: 3 })).toEqual([]);
  });

  it('compares dates by their instant', () => {
    expect(
      errorsOf(DateRange, {
        from: '2026-10-02T00:00:00.000Z',
        to: '2026-10-01T23:59:59.999Z',
      }).map((error) => error.property),
    ).toEqual(['to']);
    expect(
      errorsOf(DateRange, {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    ).toEqual([]);
  });
});

describe('IsNotBelow, with an invalid bound', () => {
  it('leaves an unreadable lower bound to its own validator instead of failing the upper one too', () => {
    expect(errorsOf(NumberRange, { from: Number.NaN, to: 2 })).toEqual([]);
  });
});

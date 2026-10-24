import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateTraderSettingsDto } from '../dto/update-trader-settings.dto';

const failedProperties = (body: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(UpdateTraderSettingsDto, body)).map(
    (error) => error.property,
  );

describe('UpdateTraderSettingsDto insurancePayInMin', () => {
  it('may be absent', () => {
    expect(failedProperties({})).toEqual([]);
  });

  it('accepts null, which resets to the global default', () => {
    expect(failedProperties({ insurancePayInMin: null })).toEqual([]);
  });

  it('accepts zero and a three-decimal amount', () => {
    expect(failedProperties({ insurancePayInMin: 0 })).toEqual([]);
    expect(failedProperties({ insurancePayInMin: 12.345 })).toEqual([]);
  });

  it('rejects a negative amount', () => {
    expect(failedProperties({ insurancePayInMin: -1 })).toEqual([
      'insurancePayInMin',
    ]);
  });

  it('rejects more than three decimals', () => {
    expect(failedProperties({ insurancePayInMin: 1.2345 })).toEqual([
      'insurancePayInMin',
    ]);
  });

  it('rejects a non-number', () => {
    expect(failedProperties({ insurancePayInMin: 'abc' })).toEqual([
      'insurancePayInMin',
    ]);
  });
});

describe('UpdateTraderSettingsDto insurancePayOutMin', () => {
  it('accepts null, zero and a three-decimal amount', () => {
    expect(failedProperties({ insurancePayOutMin: null })).toEqual([]);
    expect(failedProperties({ insurancePayOutMin: 0 })).toEqual([]);
    expect(failedProperties({ insurancePayOutMin: 12.345 })).toEqual([]);
  });

  it('rejects a negative amount, four decimals and a non-number', () => {
    for (const value of [-1, 1.2345, 'abc']) {
      expect(failedProperties({ insurancePayOutMin: value })).toEqual([
        'insurancePayOutMin',
      ]);
    }
  });
});

describe('UpdateTraderSettingsDto night stop', () => {
  it('accepts the switch', () => {
    expect(failedProperties({ nightStopEnabled: false })).toEqual([]);
    expect(failedProperties({ nightStopEnabled: true })).toEqual([]);
  });

  it('rejects a non-boolean switch', () => {
    expect(failedProperties({ nightStopEnabled: 'no' })).toEqual([
      'nightStopEnabled',
    ]);
  });

  it('accepts null and every integer from 1 to 10', () => {
    expect(failedProperties({ nightStopThreshold: null })).toEqual([]);
    for (let n = 1; n <= 10; n++) {
      expect(failedProperties({ nightStopThreshold: n })).toEqual([]);
    }
  });

  it('rejects out-of-range, fractional and non-numeric thresholds instead of clamping', () => {
    for (const value of [0, 11, -1, 100, 1.5, 'abc']) {
      expect(failedProperties({ nightStopThreshold: value })).toEqual([
        'nightStopThreshold',
      ]);
    }
  });
});

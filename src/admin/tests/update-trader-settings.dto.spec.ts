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

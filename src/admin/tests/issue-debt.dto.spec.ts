import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IssueDebtDto } from '../dto/issue-debt.dto';
import { WriteOffDebtDto } from '../dto/write-off-debt.dto';

const failed = (
  dto: typeof IssueDebtDto | typeof WriteOffDebtDto,
  payload: Record<string, unknown>,
): string[] =>
  validateSync(plainToInstance(dto, payload)).map((error) => error.property);

describe('IssueDebtDto', () => {
  it('accepts a positive decimal string with up to six decimals', () => {
    expect(failed(IssueDebtDto, { amount: '400.123456' })).toEqual([]);
  });

  it.each(['0', '-1', '1.1234567', 400, null])('refuses %p', (amount) => {
    expect(failed(IssueDebtDto, { amount })).toEqual(['amount']);
  });

  it('accepts one trillion and refuses anything above it', () => {
    expect(failed(IssueDebtDto, { amount: '1000000000000' })).toEqual([]);
    expect(failed(IssueDebtDto, { amount: '1000000000000.000001' })).toEqual([
      'amount',
    ]);
  });

  it('requires the amount', () => {
    expect(failed(IssueDebtDto, {})).toEqual(['amount']);
  });
});

describe('WriteOffDebtDto', () => {
  it('accepts an absent amount, which means the whole remaining debt', () => {
    expect(failed(WriteOffDebtDto, {})).toEqual([]);
  });

  it('accepts a positive decimal string with up to six decimals', () => {
    expect(failed(WriteOffDebtDto, { amount: '0.000001' })).toEqual([]);
  });

  it('accepts one trillion and refuses anything above it', () => {
    expect(failed(WriteOffDebtDto, { amount: '1000000000000' })).toEqual([]);
    expect(failed(WriteOffDebtDto, { amount: '1000000000001' })).toEqual([
      'amount',
    ]);
  });

  it.each(['0', '-5', '1.1234567', 5, null])('refuses %p', (amount) => {
    expect(failed(WriteOffDebtDto, { amount })).toEqual(['amount']);
  });
});

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
  it('accepts a positive amount with up to three decimals', () => {
    expect(failed(IssueDebtDto, { amount: 400.125 })).toEqual([]);
  });

  it.each([0, -1, 1.2345, '400', null])('refuses %p', (amount) => {
    expect(failed(IssueDebtDto, { amount })).toEqual(['amount']);
  });

  it('accepts 1e15 and refuses anything above what numeric(20,3) holds', () => {
    expect(failed(IssueDebtDto, { amount: 1e15 })).toEqual([]);
    expect(failed(IssueDebtDto, { amount: 1e15 + 1 })).toEqual(['amount']);
  });

  it('requires the amount', () => {
    expect(failed(IssueDebtDto, {})).toEqual(['amount']);
  });
});

describe('WriteOffDebtDto', () => {
  it('accepts an absent amount, which means the whole remaining debt', () => {
    expect(failed(WriteOffDebtDto, {})).toEqual([]);
  });

  it('accepts a positive amount with up to three decimals', () => {
    expect(failed(WriteOffDebtDto, { amount: 0.001 })).toEqual([]);
  });

  it('accepts 1e15 and refuses anything above it', () => {
    expect(failed(WriteOffDebtDto, { amount: 1e15 })).toEqual([]);
    expect(failed(WriteOffDebtDto, { amount: 1e15 + 1 })).toEqual(['amount']);
  });

  it.each([0, -5, 1.2345, null])('refuses %p', (amount) => {
    expect(failed(WriteOffDebtDto, { amount })).toEqual(['amount']);
  });
});

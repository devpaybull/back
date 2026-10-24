import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';
import { BalanceOperationDto } from '../dto/balance-operation.dto';
import { balanceOperationsCsv } from '../utils/balance-operations-csv';

describe('balanceOperationsCsv', () => {
  const row = (
    overrides: Partial<BalanceOperationDto> = {},
  ): BalanceOperationDto => ({
    id: 1,
    createdAt: new Date('2026-10-24T12:30:00.000Z'),
    type: BalanceOperationType.Transaction,
    kind: BalanceKind.Main,
    amount: -12.5,
    balanceBefore: 100,
    balanceAfter: 87.5,
    reference: { transactionId: 'tx-1', debtId: null },
    ...overrides,
  });

  it('is only the header for no rows, with a CRLF line ending', () => {
    expect(balanceOperationsCsv([])).toBe(
      'date,type,kind,amount,balanceBefore,balanceAfter,reference\r\n',
    );
  });

  it('writes an ISO date, signed numbers and the reference per row', () => {
    expect(balanceOperationsCsv([row()])).toBe(
      'date,type,kind,amount,balanceBefore,balanceAfter,reference\r\n' +
        '2026-10-24T12:30:00.000Z,transaction,main,-12.5,100,87.5,transaction:tx-1\r\n',
    );
  });

  it('names a debt reference and leaves an absent one empty', () => {
    const csv = balanceOperationsCsv([
      row({
        type: BalanceOperationType.DebtIssued,
        reference: { transactionId: null, debtId: 7 },
      }),
      row({ reference: null }),
    ]);

    expect(csv).toContain(',debt:7\r\n');
    expect(csv.split('\r\n')[2]).toMatch(/,87\.5,$/);
  });

  it('quotes a field with a comma, a quote or a line break, doubling quotes', () => {
    const csv = balanceOperationsCsv([
      row({ reference: { transactionId: 'a,"b"\nc', debtId: null } }),
    ]);

    expect(csv).toContain(',"transaction:a,""b""\nc"\r\n');
  });
});

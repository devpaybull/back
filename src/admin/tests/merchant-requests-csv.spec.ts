import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantRequestOperation } from '../../merchant-requests/types/merchant-request-operation.enum';
import { MerchantRequestResult } from '../../merchant-requests/types/merchant-request-result.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { MerchantRequestDto } from '../dto/merchant-request.dto';
import { merchantRequestsCsv } from '../utils/merchant-requests-csv';

const row: MerchantRequestDto = {
  id: uuidOf(1),
  receivedAt: new Date('2026-11-05T08:25:54.000Z'),
  merchant: { id: uuidOf(3), name: 'Casino, "Royal"' },
  operation: MerchantRequestOperation.PayInCreate,
  direction: TransactionKind.PayIn,
  method: 'sbp',
  amount: '2000.00',
  currency: 'RUB',
  bank: { id: 7, code: 'tbank', name: 'Т-банк' },
  payerUserId: '=HYPERLINK("x")',
  merchantTransactionId: 'order-1',
  result: MerchantRequestResult.NotCreated,
  statusCode: 403,
  errorCode: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
  processedBy: null,
  durationMs: 50,
  transactionId: null,
};

describe('merchantRequestsCsv', () => {
  it('writes a header and one CRLF line per request, without headers or bodies', () => {
    const lines = merchantRequestsCsv([row]).split('\r\n');

    expect(lines[0]).toBe(
      'receivedAt,id,merchantId,merchant,operation,direction,method,amount,currency,bank,payerUserId,merchantTransactionId,result,statusCode,errorCode,processedBy,durationMs,transactionId',
    );
    expect(lines[1]).toBe(
      `2026-11-05T08:25:54.000Z,${uuidOf(1)},${uuidOf(3)},"Casino, ""Royal""",pay_in_create,pay_in,sbp,2000.00,RUB,tbank,"'=HYPERLINK(""x"")",order-1,not_created,403,NO_REQUISITE_FOUND_FOR_THIS_AMOUNT,,50,`,
    );
    expect(lines[2]).toBe('');
  });

  it('leaves the empty fields of a read empty', () => {
    const [, line] = merchantRequestsCsv([
      {
        ...row,
        merchant: { id: uuidOf(3), name: null },
        operation: null,
        direction: null,
        method: null,
        amount: null,
        currency: null,
        bank: null,
        payerUserId: null,
        merchantTransactionId: null,
        result: MerchantRequestResult.Ok,
        statusCode: 200,
        errorCode: null,
      },
    ]).split('\r\n');

    expect(line).toBe(
      `2026-11-05T08:25:54.000Z,${uuidOf(1)},${uuidOf(3)},,,,,,,,,,ok,200,,,50,`,
    );
  });
});

import { uuidTextContains } from '../utils/uuid-text-contains';

describe('uuidTextContains', () => {
  it('quotes the column path so Postgres keeps the alias’s case', () => {
    const operator = uuidTextContains('AB12');
    const sql = (operator.getSql as (column: string) => string)(
      'Transaction.id',
    );

    expect(sql).toBe('"Transaction"."id"::text ILIKE :uuidPiece');
    expect(operator.objectLiteralParameters).toEqual({ uuidPiece: '%ab12%' });
  });

  it('escapes the LIKE wildcards', () => {
    expect(uuidTextContains('a%_\\').objectLiteralParameters).toEqual({
      uuidPiece: '%a\\%\\_\\\\%',
    });
  });
});

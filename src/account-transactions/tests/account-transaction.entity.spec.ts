import { getMetadataArgsStorage } from 'typeorm';
import { AccountTransaction } from '../entities/account-transaction.entity';

describe('AccountTransaction', () => {
  it('allows a counterparty on a transfer and on nothing else', () => {
    const checks = getMetadataArgsStorage().checks.filter(
      (check) => check.target === AccountTransaction,
    );

    expect(checks.map((check) => check.expression)).toContain(
      `("type" = 'transfer') = ("counterpartyUserId" IS NOT NULL)`,
    );
  });

  it('keeps the fields of each type on that type', () => {
    const expressions = getMetadataArgsStorage()
      .checks.filter((check) => check.target === AccountTransaction)
      .map((check) => check.expression);

    expect(expressions).toEqual(
      expect.arrayContaining([
        `"type" = 'withdrawal' OR ("fee" IS NULL AND "paidManually" IS NULL)`,
        `"type" = 'deposit' OR ("addressId" IS NULL AND "expiresAt" IS NULL AND "amountReceived" IS NULL)`,
        `"type" <> 'withdrawal' OR "address" IS NOT NULL`,
      ]),
    );
  });

  it('indexes the type and status together for the lists', () => {
    const indices = getMetadataArgsStorage().indices.filter(
      (index) => index.target === AccountTransaction,
    );

    expect(indices.map((index) => index.columns)).toContainEqual([
      'type',
      'status',
    ]);
  });
});

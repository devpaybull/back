import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AddLeadDto } from '../dto/add-lead.dto';
import { ReplaceLeadsDto } from '../dto/replace-leads.dto';

describe('the lead assignment DTOs', () => {
  const row = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    leadUserId: uuidOf(20),
    currencyId: 1,
    payInPercent: 2.5,
    payOutPercent: 0.5,
    ...overrides,
  });

  const errorsOf = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(AddLeadDto, plain));

  it('accepts a whole row', () => {
    expect(errorsOf(row())).toHaveLength(0);
  });

  it.each(['leadUserId', 'currencyId', 'payInPercent', 'payOutPercent'])(
    'requires %s',
    (field) => {
      const { [field]: _dropped, ...without } = row();

      expect(_dropped).toBeDefined();
      expect(errorsOf(without)).not.toHaveLength(0);
    },
  );

  it.each([
    ['a negative pay-in percent', { payInPercent: -1 }],
    ['four decimals', { payOutPercent: 0.0005 }],
    ['a lead id that is not a uuid', { leadUserId: 'lead' }],
    ['a currency id below 1', { currencyId: 0 }],
  ])('refuses %s', (_name, overrides) => {
    expect(errorsOf(row(overrides))).not.toHaveLength(0);
  });

  it('accepts a zero rate', () => {
    expect(errorsOf(row({ payInPercent: 0, payOutPercent: 0 }))).toHaveLength(
      0,
    );
  });

  it('validates every row of a replacement and accepts an empty one', () => {
    expect(
      validateSync(plainToInstance(ReplaceLeadsDto, { leads: [] })),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(ReplaceLeadsDto, {
          leads: [row(), row({ payInPercent: -2 })],
        }),
      ),
    ).not.toHaveLength(0);
  });
});

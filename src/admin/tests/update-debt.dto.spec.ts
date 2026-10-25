import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateDebtDto } from '../dto/update-debt.dto';

const parse = (payload: Record<string, unknown>) =>
  plainToInstance(UpdateDebtDto, payload);

const failedProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(parse(payload)).map((error) => error.property);

const inAnHour = () => new Date(Date.now() + 3600_000).toISOString();

describe('UpdateDebtDto', () => {
  it('accepts a comment, a future moment and a pause flag', () => {
    expect(
      failedProperties({
        comment: 'returns on Friday',
        autoWriteOffAt: inAnHour(),
        autoWriteOffPaused: true,
      }),
    ).toEqual([]);
  });

  it('accepts null for the comment and for the moment, keeping the null', () => {
    const dto = parse({ comment: null, autoWriteOffAt: null });

    expect(validateSync(dto)).toEqual([]);
    expect(dto.comment).toBeNull();
    expect(dto.autoWriteOffAt).toBeNull();
  });

  it('refuses a moment that has already passed', () => {
    expect(
      failedProperties({
        autoWriteOffAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toEqual(['autoWriteOffAt']);
  });

  it('refuses something that is not a date', () => {
    expect(failedProperties({ autoWriteOffAt: 'tomorrow' })).toEqual([
      'autoWriteOffAt',
    ]);
  });

  it('refuses a null pause flag', () => {
    expect(failedProperties({ autoWriteOffPaused: null })).toEqual([
      'autoWriteOffPaused',
    ]);
  });

  it('trims the comment and refuses one that is blank', () => {
    expect(parse({ comment: '  hi  ' }).comment).toBe('hi');
    expect(failedProperties({ comment: '   ' })).toEqual(['comment']);
  });

  it('refuses a comment over 500 characters', () => {
    expect(failedProperties({ comment: 'x'.repeat(501) })).toEqual(['comment']);
  });
});

describe('UpdateDebtDto message for a past autoWriteOffAt', () => {
  it('says the moment must be in the future instead of printing the bound function', () => {
    const [error] = validateSync(
      plainToInstance(UpdateDebtDto, {
        autoWriteOffAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    expect(Object.values(error.constraints ?? {})).toEqual([
      'autoWriteOffAt must be a moment in the future',
    ]);
  });
});

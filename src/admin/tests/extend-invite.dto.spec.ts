import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ExtendInviteDto } from '../dto/extend-invite.dto';

const failedProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(ExtendInviteDto, payload)).map(
    (error) => error.property,
  );

describe('ExtendInviteDto', () => {
  it('accepts a moment in the future', () => {
    expect(
      failedProperties({
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    ).toEqual([]);
  });

  it('accepts a moment far in the future, since there is no ceiling', () => {
    expect(
      failedProperties({
        expiresAt: new Date(Date.now() + 3650 * 86400_000).toISOString(),
      }),
    ).toEqual([]);
  });

  it('refuses a moment that has already passed', () => {
    expect(
      failedProperties({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toEqual(['expiresAt']);
  });

  it('requires expiresAt', () => {
    expect(failedProperties({})).toEqual(['expiresAt']);
  });

  it('refuses something that is not a date at all', () => {
    expect(failedProperties({ expiresAt: 'tomorrow' })).toEqual(['expiresAt']);
  });

  it('arrives as a Date, not as the string that was sent', () => {
    const dto = plainToInstance(ExtendInviteDto, {
      expiresAt: '2030-01-01T00:00:00.000Z',
    });

    expect(dto.expiresAt).toBeInstanceOf(Date);
  });
});

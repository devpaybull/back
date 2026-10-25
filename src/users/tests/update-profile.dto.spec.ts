import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from '../dto/update-profile.dto';

const failedProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(UpdateProfileDto, payload)).map(
    (error) => error.property,
  );

describe('UpdateProfileDto', () => {
  it('accepts an empty payload and each field on its own', () => {
    expect(failedProperties({})).toEqual([]);
    expect(failedProperties({ email: 'user@example.com' })).toEqual([]);
    expect(failedProperties({ telegramUsername: '@durov' })).toEqual([]);
  });

  it.each(['email', 'telegramUsername'])('refuses null for %s', (field) => {
    expect(failedProperties({ [field]: null })).toEqual([field]);
  });
});

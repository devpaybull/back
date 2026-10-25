import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateDeviceDto } from '../dto/create-device.dto';

const parse = (given: Record<string, unknown>): CreateDeviceDto =>
  plainToInstance(CreateDeviceDto, given);

const failedProperties = (given: Record<string, unknown>): string[] =>
  validateSync(parse(given)).map((error) => error.property);

const refusedByTheGlobalPipe = (given: Record<string, unknown>): string[] =>
  validateSync(parse(given), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);

describe('CreateDeviceDto', () => {
  it('accepts a name on its own', () => {
    expect(failedProperties({ name: 'Pixel 7' })).toEqual([]);
  });

  it('requires the name', () => {
    expect(failedProperties({})).toEqual(['name']);
  });

  it('refuses a blank name, which would list as an unnamed row', () => {
    expect(failedProperties({ name: '   ' })).toEqual(['name']);
  });

  it('trims what was pasted', () => {
    expect(parse({ name: '  Pixel 7  ' }).name).toBe('Pixel 7');
  });

  it('refuses a name past 100 characters', () => {
    expect(failedProperties({ name: 'A'.repeat(101) })).toEqual(['name']);
  });

  it.each([
    'key',
    'status',
    'model',
    'type',
    'phone',
    'lastActivity',
    'userId',
  ])(
    'refuses %s, which belongs to the phone app and not to the owner',
    (field) => {
      expect(
        refusedByTheGlobalPipe({ name: 'Pixel 7', [field]: 'smuggled' }),
      ).toEqual([field]);
    },
  );

  it('accepts the bare name under the same rules the global pipe applies', () => {
    expect(refusedByTheGlobalPipe({ name: 'Pixel 7' })).toEqual([]);
  });
});

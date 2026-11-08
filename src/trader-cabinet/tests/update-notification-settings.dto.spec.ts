import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateNotificationSettingsDto } from '../dto/update-notification-settings.dto';

const errorsOf = async <T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> =>
  (await validate(plainToInstance(type, plain), { whitelist: true })).map(
    (error) => error.property,
  );

describe('UpdateNotificationSettingsDto', () => {
  it('takes a threshold as a positive USDT string, never a number, and a method of the registry or all', async () => {
    expect(
      await errorsOf(UpdateNotificationSettingsDto, {
        settings: [
          {
            type: 'balance_below_threshold',
            enabled: true,
            threshold: '100.123456',
          },
          {
            type: 'requisite_limit_reached',
            enabled: true,
            method: 'all',
            limitType: 'hourly',
          },
        ],
      }),
    ).toEqual([]);

    for (const change of [
      { type: 'balance_below_threshold', enabled: true, threshold: 100 },
      { type: 'balance_below_threshold', enabled: true, threshold: '0' },
      {
        type: 'balance_below_threshold',
        enabled: true,
        threshold: '1.1234567',
      },
      { type: 'requisite_limit_reached', enabled: true, method: 'cash' },
      { type: 'requisite_limit_reached', enabled: true, limitType: 'weekly' },
      { type: 'nonsense', enabled: true },
      { type: 'new_payouts' },
      { type: 'balance_below_threshold', enabled: true, threshold: null },
      { type: 'requisite_limit_reached', enabled: true, method: null },
      { type: 'requisite_limit_reached', enabled: true, limitType: null },
    ]) {
      expect(
        await errorsOf(UpdateNotificationSettingsDto, { settings: [change] }),
      ).toEqual(['settings']);
    }
    expect(
      await errorsOf(UpdateNotificationSettingsDto, { settings: [] }),
    ).toEqual(['settings']);
  });
});

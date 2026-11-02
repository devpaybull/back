import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { UserStatus } from '../../users/types/user-status.enum';
import { MerchantSettingsController } from '../controllers/merchant-settings.controller';
import { UpdateMerchantLinksDto } from '../dto/update-merchant-links.dto';

const MERCHANT = uuidOf(30);
const user: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'shop',
  role: Role.Merchant,
  status: UserStatus.Active,
};
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('MerchantSettingsController', () => {
  const build = (key: object | null = null) => {
    const settings = {
      settingsOf: jest.fn(async () => ({
        supportLink: 'https://t.me/shop',
        callbackUrl: null,
        successUrl: null,
        errorUrl: null,
        payoutOverdraftEnabled: true,
      })),
      update: jest.fn(async () => ({})),
    };
    const merchants = { newestActiveKey: jest.fn(async () => key) };

    return {
      settings,
      controller: new MerchantSettingsController(
        settings as never,
        merchants as never,
      ),
    };
  };

  it('lets only the merchant account write, and marks the write', () => {
    const handler = MerchantSettingsController.prototype.update;

    expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toEqual([
      Role.Merchant,
    ]);
    expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(true);
  });

  it('answers the links and the key without its secret, nothing else of the settings', async () => {
    const { controller } = build({
      id: 3,
      key: 'k-1',
      secret: 'never',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });

    expect(await controller.read(MERCHANT)).toEqual({
      supportLink: 'https://t.me/shop',
      callbackUrl: null,
      successUrl: null,
      errorUrl: null,
      apiKey: {
        id: 3,
        key: 'k-1',
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
    });
  });

  it('writes the four links with the account as actor and its feed row', async () => {
    const { controller, settings } = build();

    await controller.update(
      MERCHANT,
      { callbackUrl: 'https://shop.example/cb', supportLink: null },
      user,
    );

    expect(settings.update).toHaveBeenCalledWith(
      MERCHANT,
      {
        supportLink: null,
        callbackUrl: 'https://shop.example/cb',
        successUrl: undefined,
        errorUrl: undefined,
      },
      user.id,
      'merchant_activity.links_updated',
    );
  });

  it.each([
    [{ callbackUrl: 'http://shop.example/cb' }],
    [{ payoutOverdraftEnabled: true }],
    [{ ipCheckEnabled: true }],
  ])('refuses %p with a 400', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: UpdateMerchantLinksDto }),
    ).rejects.toThrow(BadRequestException);
  });
});

import {
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { SkipIpCheck } from '../decorators/skip-ip-check.decorator';
import { MerchantApiKeyGuard } from '../guards/merchant-api-key.guard';
import { MerchantApiErrorCode } from '../types/merchant-api-error-code.enum';
import { MerchantApiRequest } from '../types/merchant-api-request';

const MERCHANT = uuidOf(1);

@Controller('v1/probe')
class ProbeController {
  @Get()
  read(): void {}

  @Get('pay-out')
  @SkipIpCheck()
  payOut(): void {}
}

const build = (
  options: {
    found?: { merchantActive: boolean } | null;
    admits?: boolean;
  } = {},
) => {
  const merchants = {
    authenticateKey: jest.fn(async () =>
      options.found === null
        ? null
        : {
            merchantId: MERCHANT,
            apiKeyId: 4,
            merchantActive: options.found?.merchantActive ?? true,
          },
    ),
  };
  const addresses = { admits: jest.fn(async () => options.admits ?? true) };
  const guard = new MerchantApiKeyGuard(
    merchants as never,
    addresses as never,
    new Reflector(),
  );

  return { guard, merchants, addresses };
};

const contextOf = (
  request: Partial<MerchantApiRequest>,
  handler: keyof ProbeController = 'read',
): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ProbeController.prototype[handler],
    getClass: () => ProbeController,
  }) as unknown as ExecutionContext;

const codeOf = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return ((error as HttpException).getResponse() as { code: string }).code;
  }

  return undefined;
};

describe('MerchantApiKeyGuard', () => {
  it('lets a valid key of an active merchant through and puts the merchant on the request', async () => {
    const { guard, merchants, addresses } = build();
    const request: Partial<MerchantApiRequest> = {
      headers: { 'x-secure-key': ' key-1 ' },
      ip: '203.0.113.7',
    };

    await expect(guard.canActivate(contextOf(request))).resolves.toBe(true);
    expect(merchants.authenticateKey).toHaveBeenCalledWith('key-1');
    expect(addresses.admits).toHaveBeenCalledWith(MERCHANT, '203.0.113.7');
    expect(request.apiMerchant).toEqual({ merchantId: MERCHANT, apiKeyId: 4 });
  });

  it.each([
    ['no header', {}],
    ['an empty header', { 'x-secure-key': '  ' }],
    ['a repeated header', { 'x-secure-key': ['a', 'b'] }],
  ])(
    'answers 401 INVALID_API_KEY for %s without a lookup',
    async (_, headers) => {
      const { guard, merchants } = build();
      const request = { headers } as unknown as MerchantApiRequest;

      await expect(
        guard.canActivate(contextOf(request)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(await codeOf(guard.canActivate(contextOf(request)))).toBe(
        MerchantApiErrorCode.InvalidApiKey,
      );
      expect(merchants.authenticateKey).not.toHaveBeenCalled();
      expect(request.apiMerchant).toBeUndefined();
    },
  );

  it('answers 401 INVALID_API_KEY for an unknown or revoked key and identifies nobody', async () => {
    const { guard } = build({ found: null });
    const request: Partial<MerchantApiRequest> = {
      headers: { 'x-secure-key': 'gone' },
    };

    expect(await codeOf(guard.canActivate(contextOf(request)))).toBe(
      MerchantApiErrorCode.InvalidApiKey,
    );
    expect(request.apiMerchant).toBeUndefined();
  });

  it('answers 403 MERCHANT_DISABLED for a switched-off merchant, still identified', async () => {
    const { guard, addresses } = build({ found: { merchantActive: false } });
    const request: Partial<MerchantApiRequest> = {
      headers: { 'x-secure-key': 'key-1' },
    };

    await expect(guard.canActivate(contextOf(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(await codeOf(guard.canActivate(contextOf(request)))).toBe(
      MerchantApiErrorCode.MerchantDisabled,
    );
    expect(request.apiMerchant).toEqual({ merchantId: MERCHANT, apiKeyId: 4 });
    expect(addresses.admits).not.toHaveBeenCalled();
  });

  it('answers 403 MERCHANT_DISABLED on a handler without the IP check too', async () => {
    const { guard } = build({ found: { merchantActive: false } });
    const request = { headers: { 'x-secure-key': 'key-1' } };

    expect(await codeOf(guard.canActivate(contextOf(request, 'payOut')))).toBe(
      MerchantApiErrorCode.MerchantDisabled,
    );
  });

  it('answers 403 IP_NOT_ALLOWED when the whitelist refuses the address', async () => {
    const { guard } = build({ admits: false });
    const request: Partial<MerchantApiRequest> = {
      headers: { 'x-secure-key': 'key-1' },
      ip: '198.51.100.1',
    };

    expect(await codeOf(guard.canActivate(contextOf(request)))).toBe(
      MerchantApiErrorCode.IpNotAllowed,
    );
    expect(request.apiMerchant).toEqual({ merchantId: MERCHANT, apiKeyId: 4 });
  });

  it('skips the whitelist on a handler marked @SkipIpCheck()', async () => {
    const { guard, addresses } = build({ admits: false });
    const request = { headers: { 'x-secure-key': 'key-1' } };

    await expect(guard.canActivate(contextOf(request, 'payOut'))).resolves.toBe(
      true,
    );
    expect(addresses.admits).not.toHaveBeenCalled();
  });
});

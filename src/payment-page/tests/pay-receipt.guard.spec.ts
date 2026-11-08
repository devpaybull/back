import {
  ExecutionContext,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { PayReceiptGuard } from '../guards/pay-receipt.guard';

const TOKEN = 'a'.repeat(43);

describe('PayReceiptGuard', () => {
  const contextOf = (ip: string, response = new EventEmitter()) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ ip, params: { token: TOKEN } }),
        getResponse: () => response,
      }),
    }) as unknown as ExecutionContext;

  it('checks the token and the receipt room before letting the upload be read', async () => {
    const pages = { assertAcceptsReceipt: jest.fn(async () => undefined) };
    const guard = new PayReceiptGuard(pages as never);

    await expect(guard.canActivate(contextOf('203.0.113.7'))).resolves.toBe(
      true,
    );
    expect(pages.assertAcceptsReceipt).toHaveBeenCalledWith(TOKEN);
  });

  it('passes the page’s refusal through', async () => {
    const pages = {
      assertAcceptsReceipt: jest.fn(async () => {
        throw new NotFoundException();
      }),
    };
    const guard = new PayReceiptGuard(pages as never);

    await expect(
      guard.canActivate(contextOf('203.0.113.7')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows two uploads in progress per client, refuses the third with 429, and frees a slot when one ends', async () => {
    const pages = { assertAcceptsReceipt: jest.fn(async () => undefined) };
    const guard = new PayReceiptGuard(pages as never);
    const first = new EventEmitter();

    await guard.canActivate(contextOf('2001:db8:1:2::1', first));
    await guard.canActivate(contextOf('2001:db8:1:2::2'));

    const refused = await guard
      .canActivate(contextOf('2001:db8:1:2::3'))
      .catch((caught: unknown) => caught);

    expect((refused as HttpException).getStatus()).toBe(429);
    expect((refused as HttpException).getResponse()).toMatchObject({
      code: 'TOO_MANY_UPLOADS',
    });
    expect(pages.assertAcceptsReceipt).toHaveBeenCalledTimes(2);

    await expect(guard.canActivate(contextOf('203.0.113.7'))).resolves.toBe(
      true,
    );

    first.emit('close');
    await expect(guard.canActivate(contextOf('2001:db8:1:2::4'))).resolves.toBe(
      true,
    );
  });

  it('frees the slot of a refused upload too', async () => {
    const pages = {
      assertAcceptsReceipt: jest.fn(async () => {
        throw new NotFoundException();
      }),
    };
    const guard = new PayReceiptGuard(pages as never);

    for (let i = 0; i < 5; i++) {
      const response = new EventEmitter();

      await guard
        .canActivate(contextOf('203.0.113.7', response))
        .catch(() => 0);
      response.emit('close');
    }

    expect(
      (guard as unknown as { inProgress: Map<string, number> }).inProgress.size,
    ).toBe(0);
  });

  it('holds at most 8 uploads in flight across all clients, refusing the ninth with 429 until one ends', async () => {
    const pages = { assertAcceptsReceipt: jest.fn(async () => undefined) };
    const guard = new PayReceiptGuard(pages as never);
    const responses = Array.from({ length: 8 }, () => new EventEmitter());

    for (const [index, response] of responses.entries()) {
      await guard.canActivate(contextOf(`203.0.113.${index + 1}`, response));
    }

    const refused = await guard
      .canActivate(contextOf('198.51.100.1'))
      .catch((caught: unknown) => caught);

    expect((refused as HttpException).getStatus()).toBe(429);
    expect((refused as HttpException).getResponse()).toMatchObject({
      code: 'TOO_MANY_UPLOADS',
    });
    expect(pages.assertAcceptsReceipt).toHaveBeenCalledTimes(8);

    responses[3].emit('close');
    await expect(guard.canActivate(contextOf('198.51.100.1'))).resolves.toBe(
      true,
    );
  });
});

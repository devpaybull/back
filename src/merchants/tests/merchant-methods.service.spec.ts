import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantMethod } from '../entities/merchant-method.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantMethodsService } from '../services/merchant-methods.service';

jest.mock('../../transactions/utils/find-transaction-method', () => {
  const actual = jest.requireActual<
    typeof import('../../transactions/utils/find-transaction-method')
  >('../../transactions/utils/find-transaction-method');

  return {
    findTransactionMethod: (code: string) =>
      code === 'in_only'
        ? {
            code,
            currency: 'RUB',
            rateKind: 'by_amount',
            directions: ['pay_in'],
          }
        : actual.findTransactionMethod(code),
  };
});

const MERCHANT = uuidOf(3);
const ACTOR = uuidOf(9);

const build = (merchantExists = true, stored: MerchantMethod[] = []) => {
  const manager = {
    findOne: jest.fn(async () => (merchantExists ? { id: MERCHANT } : null)),
    delete: jest.fn(async () => undefined),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (rows: unknown) => rows),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const repository = { find: jest.fn(async () => stored) };
  const audit = { record: jest.fn(async () => undefined) };

  return {
    manager,
    repository,
    audit,
    service: new MerchantMethodsService(
      repository as never,
      dataSource as never,
      audit as never,
    ),
  };
};

describe('MerchantMethodsService', () => {
  it('answers every registry method, off where nothing is stored', async () => {
    const { service, repository } = build(true, [
      {
        merchantId: MERCHANT,
        method: 'card',
        payInEnabled: true,
        payOutEnabled: false,
      } as MerchantMethod,
    ]);

    const states = await service.statesByMerchant([MERCHANT]);

    expect(repository.find).toHaveBeenCalledWith({
      where: { merchantId: In([MERCHANT]) },
    });
    expect(states.get(MERCHANT)).toEqual([
      { method: 'sbp', payInEnabled: false, payOutEnabled: false },
      { method: 'card', payInEnabled: true, payOutEnabled: false },
      { method: 'counterparty', payInEnabled: false, payOutEnabled: false },
      { method: 'mobile_commerce', payInEnabled: false, payOutEnabled: false },
    ]);
  });

  it('asks nothing for no merchant', async () => {
    const { service, repository } = build();

    expect((await service.statesByMerchant([])).size).toBe(0);
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('replaces the whole set with the audit in the same transaction', async () => {
    const { service, manager, audit } = build();

    const states = await service.replace(
      MERCHANT,
      [{ method: 'sbp', payInEnabled: true, payOutEnabled: true }],
      ACTOR,
    );

    expect(manager.delete).toHaveBeenCalledWith(MerchantMethod, {
      merchantId: MERCHANT,
    });
    expect(states[0]).toEqual({
      method: 'sbp',
      payInEnabled: true,
      payOutEnabled: true,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR,
        action: 'merchant.methods_replaced',
      }),
      manager,
    );
  });

  it.each([
    [
      'an unknown method',
      [{ method: 'qr', payInEnabled: true, payOutEnabled: false }],
    ],
    [
      'a method twice',
      [
        { method: 'sbp', payInEnabled: true, payOutEnabled: false },
        { method: 'sbp', payInEnabled: false, payOutEnabled: false },
      ],
    ],
    [
      'a direction the method does not work in',
      [{ method: 'in_only', payInEnabled: false, payOutEnabled: true }],
    ],
  ])('answers 400 to %s and writes nothing', async (_label, entries) => {
    const { service, manager } = build();

    await expect(
      service.replace(MERCHANT, entries, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown merchant and deletes nothing', async () => {
    const { service, manager } = build(false);

    await expect(service.replace(MERCHANT, [], ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('locks the merchant row before deleting the old set, so two saves cannot interleave', async () => {
    const { service, manager } = build();

    await service.replace(
      MERCHANT,
      [{ method: 'sbp', payInEnabled: true, payOutEnabled: false }],
      ACTOR,
    );

    expect(manager.findOne).toHaveBeenCalledWith(Merchant, {
      where: { id: MERCHANT },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      manager.delete.mock.invocationCallOrder[0],
    );
  });
});

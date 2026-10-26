import { ForbiddenException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { UserStatus } from '../../users/types/user-status.enum';
import { DepositsController } from '../controllers/deposits.controller';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { DepositAddress } from '../entities/deposit-address.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

const ADDRESS = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

const trader = (status = UserStatus.Active): AuthenticatedUser => ({
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status,
});

const row = (overrides: Partial<AccountTransaction> = {}): AccountTransaction =>
  ({
    id: 40,
    type: AccountTransactionType.Deposit,
    status: AccountTransactionStatus.Pending,
    statusReason: null,
    amount: toCrypto(500),
    creditedAmount: null,
    address: ADDRESS,
    expiresAt: new Date('2026-10-25T12:45:00.000Z'),
    createdAt: new Date('2026-10-25T12:00:00.000Z'),
    ...overrides,
  }) as AccountTransaction;

const build = () => {
  const deposits = {
    depositAddressOf: jest.fn(
      async () => ({ address: ADDRESS }) as DepositAddress,
    ),
    existingDepositAddressOf: jest.fn(
      async (): Promise<DepositAddress | null> => null,
    ),
    createRequest: jest.fn(async () => row()),
    findOwn: jest.fn(async () => row()),
    cancelOwn: jest.fn(async () =>
      row({ status: AccountTransactionStatus.Canceled }),
    ),
  };

  return { controller: new DepositsController(deposits as never), deposits };
};

describe('DepositsController', () => {
  it('is for traders and lead traders only', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, DepositsController)).toEqual(
      [Role.Trader, Role.LeadTrader],
    );
  });

  it('marks creating and canceling as writes, and nothing else', () => {
    const { prototype } = DepositsController;
    const writes = (handler: keyof DepositsController) =>
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, prototype[handler]);

    expect(writes('create')).toBe(true);
    expect(writes('cancel')).toBe(true);
    expect(writes('depositAddress')).toBeUndefined();
    expect(writes('findOne')).toBeUndefined();
  });

  it('issues or reads the permanent address with the network and a QR code', async () => {
    const { controller, deposits } = build();

    const result = await controller.depositAddress(trader());

    expect(deposits.depositAddressOf).toHaveBeenCalledWith(uuidOf(1));
    expect(result).toEqual({
      address: ADDRESS,
      network: 'TRC20',
      qrCode: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });

  it('gives a suspended trader the address they already have, issuing nothing', async () => {
    const { controller, deposits } = build();
    deposits.existingDepositAddressOf.mockResolvedValue({
      address: ADDRESS,
    } as DepositAddress);

    await expect(
      controller.depositAddress(trader(UserStatus.Suspended)),
    ).resolves.toMatchObject({ address: ADDRESS });
    expect(deposits.depositAddressOf).not.toHaveBeenCalled();
  });

  it('refuses a suspended trader with no address yet', async () => {
    const { controller, deposits } = build();

    await expect(
      controller.depositAddress(trader(UserStatus.Suspended)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deposits.depositAddressOf).not.toHaveBeenCalled();
  });

  it('creates a request from the decimal string and answers the formatted row', async () => {
    const { controller, deposits } = build();

    const result = await controller.create({ amount: '500' }, trader());

    expect(deposits.createRequest).toHaveBeenCalledWith(
      uuidOf(1),
      toCrypto(500),
    );
    expect(result).toEqual({
      id: 40,
      amount: '500.000000',
      creditedAmount: null,
      network: 'TRC20',
      address: ADDRESS,
      qrCode: expect.stringMatching(/^data:image\/png;base64,/),
      expiresAt: new Date('2026-10-25T12:45:00.000Z'),
      status: AccountTransactionStatus.Pending,
      statusReason: null,
      createdAt: new Date('2026-10-25T12:00:00.000Z'),
    });
  });

  it('reads and cancels only through the owner-scoped service calls', async () => {
    const { controller, deposits } = build();

    await controller.findOne(40, trader());
    const canceled = await controller.cancel(40, trader());

    expect(deposits.findOwn).toHaveBeenCalledWith(40, uuidOf(1));
    expect(deposits.cancelOwn).toHaveBeenCalledWith(40, uuidOf(1));
    expect(canceled.status).toBe(AccountTransactionStatus.Canceled);
  });
});

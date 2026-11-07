import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { toRate } from '../../common/utils/to-rate';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { TraderBalancesController } from '../controllers/trader-balances.controller';
import { TransferBalanceDto } from '../dto/transfer-balance.dto';
import { BalanceTransferDirection } from '../types/balance-transfer-direction.enum';

const trader: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status: UserStatus.Active,
};

const build = (wallet: Wallet | null, rate: 'up' | 'down' = 'up') => {
  const wallets = {
    findByUserId: jest.fn(async () => wallet),
    getAvailableMain: (row: Wallet) =>
      toCrypto(row.mainBalance.minus(row.mainReserved).toString()),
  };
  const rates = {
    merchantSourceRate: jest.fn(async () => {
      if (rate === 'down') throw new Error('Rapira is down');

      return toRate('90.9');
    }),
  };
  const transfers = {
    transferOwnBalance: jest.fn(
      async () =>
        ({
          id: 3,
          type: AccountTransactionType.Transfer,
          userId: trader.id,
          counterpartyUserId: trader.id,
          fromBalance: BalanceKind.Main,
          toBalance: BalanceKind.InsurancePayIn,
          amount: toCrypto(5),
          creditedAmount: null,
          fee: null,
          address: null,
          txHash: null,
        }) as unknown as AccountTransaction,
    ),
  };
  const controller = new TraderBalancesController(
    wallets as never,
    rates as never,
    transfers as never,
  );

  return { controller, rates, transfers };
};

describe('TraderBalancesController', () => {
  const wallet = {
    mainBalance: toCrypto(1000),
    mainReserved: toCrypto(250),
    insurancePayInBalance: toCrypto(500),
    insurancePayOutBalance: toCrypto(300),
  } as Wallet;

  it('answers the balances and the rate at Rapira + 1 %', async () => {
    const { controller, rates } = build(wallet);

    await expect(controller.balances(trader)).resolves.toEqual({
      main: '1000.000000',
      mainReserved: '250.000000',
      available: '750.000000',
      insurancePayIn: '500.000000',
      insurancePayOut: '300.000000',
      rate: '90.900000',
    });
    expect(rates.merchantSourceRate).toHaveBeenCalledWith(0);
  });

  it('answers zeros with no wallet, and a null rate while Rapira is down', async () => {
    const { controller } = build(null, 'down');

    await expect(controller.balances(trader)).resolves.toEqual({
      main: '0.000000',
      mainReserved: '0.000000',
      available: '0.000000',
      insurancePayIn: '0.000000',
      insurancePayOut: '0.000000',
      rate: null,
    });
  });

  it.each([
    [
      BalanceTransferDirection.MainToInsurancePayIn,
      BalanceKind.Main,
      BalanceKind.InsurancePayIn,
    ],
    [
      BalanceTransferDirection.InsurancePayInToMain,
      BalanceKind.InsurancePayIn,
      BalanceKind.Main,
    ],
    [
      BalanceTransferDirection.InsurancePayOutToMain,
      BalanceKind.InsurancePayOut,
      BalanceKind.Main,
    ],
  ])('%s moves between the right balances', async (direction, from, to) => {
    const { controller, transfers } = build(wallet);

    await controller.transfer(trader, { direction, amount: '5' });

    expect(transfers.transferOwnBalance).toHaveBeenCalledWith({
      userId: trader.id,
      from,
      to,
      amount: toCrypto(5),
      actorUserId: trader.id,
      impersonatorUserId: null,
      insuranceDelayCheckedAt: expect.any(Date),
    });
  });

  it('answers a row with no wallet and no transaction, naming the balances', async () => {
    const { controller } = build(wallet);

    await expect(
      controller.transfer(trader, {
        direction: BalanceTransferDirection.MainToInsurancePayIn,
        amount: '5',
      }),
    ).resolves.toMatchObject({
      type: 'transfer',
      direction: 'out',
      address: null,
      txHash: null,
      fromBalance: BalanceKind.Main,
      toBalance: BalanceKind.InsurancePayIn,
      amount: '5.000000',
    });
  });

  it('is for a trader, and the transfer is a write', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, TraderBalancesController),
    ).toEqual([Role.Trader]);
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        TraderBalancesController.prototype.transfer,
      ),
    ).toBe(true);
  });
});

describe('TransferBalanceDto', () => {
  const errorsOf = (payload: object) =>
    validateSync(plainToInstance(TransferBalanceDto, payload)).map(
      (error) => error.property,
    );

  it.each(Object.values(BalanceTransferDirection))(
    'accepts %s',
    (direction) => {
      expect(errorsOf({ direction, amount: '0.000001' })).toEqual([]);
    },
  );

  it.each([
    'main_to_insurance_pay_out',
    'insurance_pay_in_to_insurance_pay_out',
    'insurance_pay_out_to_insurance_pay_in',
  ])('leaves %s to an admin', (direction) => {
    expect(errorsOf({ direction, amount: '5' })).toEqual(['direction']);
  });

  it.each([[5], ['0'], ['-1'], ['1.0000001'], ['1e3'], ['05']])(
    'refuses the amount %s',
    (amount) => {
      expect(
        errorsOf({
          direction: BalanceTransferDirection.MainToInsurancePayIn,
          amount,
        }),
      ).toEqual(['amount']);
    },
  );
});

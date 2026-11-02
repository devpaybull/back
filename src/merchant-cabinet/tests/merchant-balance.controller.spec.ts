import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { toCrypto } from '../../common/utils/to-crypto';
import { MerchantBalanceOperationType } from '../../transactions/types/merchant-balance-operation-type.enum';
import { MerchantBalanceController } from '../controllers/merchant-balance.controller';
import { ListCabinetBalanceOperationsQueryDto } from '../dto/list-cabinet-balance-operations-query.dto';

const MERCHANT = uuidOf(30);
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const operation = {
  id: 5,
  createdAt: new Date('2025-04-11T18:32:40Z'),
  type: MerchantBalanceOperationType.AdminAdjustment,
  amount: toCrypto(400),
  balanceBefore: toCrypto(2000),
  balanceAfter: toCrypto(2400),
  escrowBefore: toCrypto(0),
  escrowAfter: toCrypto(0),
  transactionId: null,
  accountTransactionId: null,
  comment: 'compensation',
  actorUserId: uuidOf(9),
};

describe('MerchantBalanceController', () => {
  const build = () => {
    const balances = {
      listOperations: jest.fn(async () =>
        toPage([[operation], 1], { page: 1, limit: 20 }),
      ),
      exportOperations: jest.fn(async () => [operation]),
    };
    const config = { getOrThrow: jest.fn(() => 'Europe/Moscow') };

    return {
      balances,
      controller: new MerchantBalanceController(
        balances as never,
        config as never,
      ),
    };
  };

  it('reads the merchant’s journal with the reasons and the deal search, without the actor', async () => {
    const { controller, balances } = build();

    const page = await controller.list(MERCHANT, {
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
      type: [MerchantBalanceOperationType.DealPayIn],
      search: 'sd12',
      from: '2025-04-11',
    });

    expect(balances.listOperations).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      from: new Date('2025-04-10T21:00:00Z'),
      to: undefined,
      types: [MerchantBalanceOperationType.DealPayIn],
      transactionIdSearch: 'sd12',
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
    });
    expect(page.items[0]).toEqual({
      id: 5,
      createdAt: new Date('2025-04-11T18:32:40Z'),
      type: MerchantBalanceOperationType.AdminAdjustment,
      amount: '400.000000',
      balanceBefore: '2000.000000',
      balanceAfter: '2400.000000',
      escrowBefore: '0.000000',
      escrowAfter: '0.000000',
      transactionId: null,
      withdrawalId: null,
      comment: 'compensation',
    });
    expect(JSON.stringify(page.items[0])).not.toContain(uuidOf(9));
  });

  it('refuses a deal search shorter than four characters', async () => {
    await expect(
      pipe.transform(
        { search: 'sd1' },
        { type: 'query', metatype: ListCabinetBalanceOperationsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

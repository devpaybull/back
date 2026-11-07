import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Role } from '../../common/enums/role.enum';
import { BankDetailsType } from '../types/bank-details-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { UserStatus } from '../../users/types/user-status.enum';
import { BankDetailsController } from '../bank-details.controller';
import { BankDetailsService } from '../bank-details.service';
import { ListBankDetailsQueryDto } from '../dto/list-bank-details-query.dto';
import { UpdateBankDetailsDto } from '../dto/update-bank-details.dto';
import { BankDetails } from '../entities/bank-details.entity';
import { BankDetailsTurnoverService } from '../../transactions/services/bank-details-turnover.service';
import { toFiat } from '../../common/utils/to-fiat';

describe('BankDetailsController', () => {
  const trader: AuthenticatedUser = {
    id: uuidOf(1),
    login: 'trader@example.com',
    role: Role.Trader,
    status: UserStatus.Active,
  };

  const details = (overrides: Partial<BankDetails> = {}): BankDetails =>
    ({
      id: uuidOf(100),
      userId: uuidOf(1),
      bankId: 1,
      bank: { id: 1, bankId: 'kaspi', name: 'Kaspi Bank' },
      type: BankDetailsType.CardOrSbp,
      cardholderName: null,
      card: '4400430212345678',
      phone: null,
      minAmountEnabled: false,
      minAmount: null,
      maxAmountEnabled: false,
      maxAmount: null,
      dailyLimitEnabled: false,
      dailyLimit: null,
      monthlyLimitEnabled: false,
      monthlyLimit: null,
      dailyAmountLimitEnabled: true,
      dailyAmountLimit: toFiat(300000),
      monthlyAmountLimitEnabled: false,
      monthlyAmountLimit: null,
      maxActiveTransactionsEnabled: false,
      maxActiveTransactions: null,
      delayBetweenRequestsEnabled: false,
      delayBetweenRequests: null,
      counterpartyOnly: false,
      reserve: false,
      active: true,
      bannedAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as BankDetails;

  const bankDetails = {
    create: jest.fn(),
    list: jest.fn(),
    findOwn: jest.fn(),
    updateOwn: jest.fn(),
    deleteOwn: jest.fn(),
    countByStatus: jest.fn(),
    history: jest.fn(),
    historyReadState: jest.fn(),
    markHistoryRead: jest.fn(),
    listTags: jest.fn(),
    createTag: jest.fn(),
    deleteTag: jest.fn(),
    counterpartyMinAmount: toFiat(5000),
    boundCounterpartiesOf: jest.fn(
      async (ids: string[]) => new Map(ids.map((id) => [id, 3])),
    ),
    tagsOf: jest.fn(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, [{ id: 7, name: 'Сбер' }]])),
    ),
  };

  const turnover = {
    turnoverOfBankDetails: jest.fn(
      async (ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            {
              total: toFiat(1000),
              today: toFiat(100),
              month: toFiat(500),
            },
          ]),
        ),
    ),
    usageOfBankDetails: jest.fn(
      async (ids: string[]) =>
        new Map(
          ids.map((id) => [id, { dealsToday: 2, lastHourAmount: toFiat(250) }]),
        ),
    ),
  };

  const createBody = {
    bankId: 1,
    deviceId: 1,
    type: BankDetailsType.CardOrSbp,
    card: '4400430212345678',
    dailyAmountLimit: '300000.00',
  };

  const query = (
    overrides: Record<string, unknown> = {},
  ): ListBankDetailsQueryDto =>
    plainToInstance(ListBankDetailsQueryDto, overrides);

  let controller: BankDetailsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    bankDetails.create.mockResolvedValue(details());
    bankDetails.list.mockResolvedValue(
      toPage([[details()], 1], { page: 1, limit: 20 }),
    );
    bankDetails.findOwn.mockResolvedValue(details());
    bankDetails.updateOwn.mockResolvedValue(details({ active: false }));

    const module = await Test.createTestingModule({
      controllers: [BankDetailsController],
      providers: [
        { provide: BankDetailsService, useValue: bankDetails },
        { provide: BankDetailsTurnoverService, useValue: turnover },
      ],
    }).compile();

    controller = module.get(BankDetailsController);
  });

  it('is restricted to traders', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, BankDetailsController),
    ).toEqual([Role.Trader]);
  });

  it.each(['create', 'update'])('marks %s as a write', (handler) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        BankDetailsController.prototype[handler],
      ),
    ).toBe(true);
  });

  it.each([
    'list',
    'findOne',
    'counts',
    'history',
    'historyReadState',
    'listTags',
  ])('leaves %s unmarked, so a suspended trader still reads', (handler) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        BankDetailsController.prototype[handler],
      ),
    ).toBeUndefined();
  });

  describe('the owner is taken from the token, never from the body', () => {
    it('attaches new details to the signed-in trader', async () => {
      await controller.create(createBody, trader);

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(1) }),
        null,
      );
    });

    it('scopes the list to the signed-in trader', async () => {
      await controller.list(query(), trader);

      expect(bankDetails.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(1) }),
      );
    });

    it('overrides a userId a caller tried to smuggle into the query', async () => {
      await controller.list(query({ userId: uuidOf(2) }), trader);

      expect(bankDetails.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(1) }),
      );
    });

    it('reads one row only through the owner-scoped finder', async () => {
      await controller.findOne(uuidOf(100), trader);

      expect(bankDetails.findOwn).toHaveBeenCalledWith(uuidOf(100), uuidOf(1));
    });

    it('patches one row only through the owner-scoped update', async () => {
      await controller.update(uuidOf(100), { reserve: true }, trader);

      expect(bankDetails.updateOwn).toHaveBeenCalledWith(
        uuidOf(100),
        uuidOf(1),
        { reserve: true },
        null,
      );
    });

    it('switches on only through the owner-scoped update', async () => {
      await controller.enable(uuidOf(100), trader);

      expect(bankDetails.updateOwn).toHaveBeenCalledWith(
        uuidOf(100),
        uuidOf(1),
        { active: true },
        null,
      );
    });

    it('switches off only through the owner-scoped update', async () => {
      await controller.disable(uuidOf(100), trader);

      expect(bankDetails.updateOwn).toHaveBeenCalledWith(
        uuidOf(100),
        uuidOf(1),
        { active: false },
        null,
      );
    });

    it('deletes one row only through the owner-scoped delete', async () => {
      await controller.remove(uuidOf(100), trader);

      expect(bankDetails.deleteOwn).toHaveBeenCalledWith(
        uuidOf(100),
        uuidOf(1),
        null,
      );
    });
  });

  describe('inside a login-link session', () => {
    const impersonated = { ...trader, impersonatedBy: uuidOf(5) };

    it('hands the superadmin who opened the session to create', async () => {
      await controller.create(createBody, impersonated);

      expect(bankDetails.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(1) }),
        uuidOf(5),
      );
    });

    it('hands the superadmin who opened the session to delete', async () => {
      await controller.remove(uuidOf(100), impersonated);

      expect(bankDetails.deleteOwn).toHaveBeenCalledWith(
        uuidOf(100),
        uuidOf(1),
        uuidOf(5),
      );
    });
  });

  it('has no way to switch active through the patch, so there is one route to it', () => {
    expect(
      validateSync(plainToInstance(UpdateBankDetailsDto, { active: false }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).map((error) => error.property),
    ).toEqual(['active']);
  });

  it.each([
    'enable',
    'disable',
    'remove',
    'createTag',
    'deleteTag',
    'markHistoryRead',
  ])('marks %s as a write', (handler) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        BankDetailsController.prototype[handler],
      ),
    ).toBe(true);
  });

  it('answers 404 for details the trader does not own', async () => {
    bankDetails.findOwn.mockResolvedValue(null);

    await expect(controller.findOne(uuidOf(100), trader)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses an empty patch rather than saving nothing', async () => {
    await expect(controller.update(uuidOf(100), {}, trader)).rejects.toThrow(
      BadRequestException,
    );
    expect(bankDetails.updateOwn).not.toHaveBeenCalled();
  });

  it('shows the owner that an administrator banned the details', async () => {
    const bannedAt = new Date();
    bankDetails.findOwn.mockResolvedValue(details({ bannedAt }));

    await expect(
      controller.findOne(uuidOf(100), trader),
    ).resolves.toMatchObject({ bannedAt });
  });

  it('keeps the meta the service produced', async () => {
    const listed = await controller.list(query(), trader);

    expect(listed.meta).toEqual({ total: 1, page: 1, limit: 20, pages: 1 });
    expect(listed.items[0]).toMatchObject({ card: '4400430212345678' });
  });

  it('composes the turnover, the usage, the slots and the tags onto every row in one batch each', async () => {
    const listed = await controller.list(query(), trader);

    expect(listed.items[0]).toMatchObject({
      turnoverTotal: '1000.00',
      turnoverToday: '100.00',
      turnoverMonth: '500.00',
      dealsToday: 2,
      lastHourAmount: '250.00',
      boundCounterparties: 3,
      tags: [{ id: 7, name: 'Сбер' }],
      status: 'active',
    });
    expect(turnover.turnoverOfBankDetails).toHaveBeenCalledTimes(1);
    expect(turnover.usageOfBankDetails).toHaveBeenCalledTimes(1);
    expect(bankDetails.tagsOf).toHaveBeenCalledWith([uuidOf(100)]);
  });

  it('hands the impersonator to a patch inside a login-link session', async () => {
    await controller.update(
      uuidOf(100),
      { reserve: true },
      { ...trader, impersonatedBy: uuidOf(5) },
    );

    expect(bankDetails.updateOwn).toHaveBeenCalledWith(
      uuidOf(100),
      uuidOf(1),
      { reserve: true },
      uuidOf(5),
    );
  });

  it('counts the tabs for the signed-in trader whatever status was asked for', async () => {
    await controller.counts(
      query({ status: 'banned', userId: uuidOf(2) }),
      trader,
    );

    expect(bankDetails.countByStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: uuidOf(1), status: undefined }),
    );
  });

  it('reads the history of the signed-in trader and tells who acted', async () => {
    bankDetails.history.mockResolvedValue(
      toPage(
        [
          [
            {
              record: {
                id: 1,
                action: 'bank_details.banned',
                actorUserId: uuidOf(9),
                metadata: { id: uuidOf(100) },
                createdAt: new Date(),
              },
              unread: true,
            },
            {
              record: {
                id: 2,
                action: 'bank_details.updated',
                actorUserId: uuidOf(1),
                metadata: { id: uuidOf(100) },
                createdAt: new Date(),
              },
              unread: false,
            },
            {
              record: {
                id: 3,
                action: 'bank_details.disabled',
                actorUserId: null,
                metadata: null,
                createdAt: new Date(),
              },
              unread: false,
            },
          ],
          3,
        ],
        { page: 1, limit: 20 },
      ),
    );

    const page = await controller.history(
      plainToInstance(ListBankDetailsQueryDto, {}),
      trader,
    );

    expect(bankDetails.history).toHaveBeenCalledWith(
      uuidOf(1),
      expect.anything(),
    );
    expect(page.items.map(({ actor, unread }) => [actor, unread])).toEqual([
      ['admin', true],
      ['trader', false],
      ['system', false],
    ]);
    expect(page.items[0].bankDetailsId).toBe(uuidOf(100));
    expect(page.items[2].bankDetailsId).toBeNull();
  });

  it('manages tags of the signed-in trader only', async () => {
    bankDetails.createTag.mockResolvedValue({
      id: 7,
      name: 'Сбер',
      createdAt: new Date(),
    });

    await controller.createTag({ name: 'Сбер' }, trader);
    await controller.deleteTag(7, trader);

    expect(bankDetails.createTag).toHaveBeenCalledWith(uuidOf(1), 'Сбер');
    expect(bankDetails.deleteTag).toHaveBeenCalledWith(uuidOf(1), 7);
  });
});

describe('BankDetailsController switch status codes', () => {
  it.each(['enable', 'disable'])(
    'answers %s with 200, since a switch creates nothing',
    (handler) => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          BankDetailsController.prototype[handler],
        ),
      ).toBe(200);
    },
  );
});

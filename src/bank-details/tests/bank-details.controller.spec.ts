import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Role } from '../../common/enums/role.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { UserStatus } from '../../users/types/user-status.enum';
import { BankDetailsController } from '../bank-details.controller';
import { BankDetailsService } from '../bank-details.service';
import { ListBankDetailsQueryDto } from '../dto/list-bank-details-query.dto';
import { UpdateBankDetailsDto } from '../dto/update-bank-details.dto';
import { BankDetails } from '../entities/bank-details.entity';

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
      type: TransactionType.Card,
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
      dailyAmountLimitEnabled: false,
      dailyAmountLimit: null,
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
      providers: [{ provide: BankDetailsService, useValue: bankDetails }],
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

  it.each(['list', 'findOne'])(
    'leaves %s unmarked, so a suspended trader still reads',
    (handler) => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          BankDetailsController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );

  describe('the owner is taken from the token, never from the body', () => {
    it('attaches new details to the signed-in trader', async () => {
      await controller.create(
        { bankId: 1, type: TransactionType.Card, card: '4400430212345678' },
        trader,
      );

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
      );
    });

    it('switches on only through the owner-scoped update', async () => {
      await controller.enable(uuidOf(100), trader);

      expect(bankDetails.updateOwn).toHaveBeenCalledWith(
        uuidOf(100),
        uuidOf(1),
        { active: true },
      );
    });

    it('switches off only through the owner-scoped update', async () => {
      await controller.disable(uuidOf(100), trader);

      expect(bankDetails.updateOwn).toHaveBeenCalledWith(
        uuidOf(100),
        uuidOf(1),
        { active: false },
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
      await controller.create(
        { bankId: 1, type: TransactionType.Card, card: '4400430212345678' },
        impersonated,
      );

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

  it.each(['enable', 'disable', 'remove'])('marks %s as a write', (handler) => {
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

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BankDetailsService } from '../../bank-details/bank-details.service';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminBankDetailsController } from '../controllers/admin-bank-details.controller';
import { ListBankDetailsQueryDto } from '../dto/list-bank-details-query.dto';
import { SuperviseBankDetailsDto } from '../dto/supervise-bank-details.dto';

describe('AdminBankDetailsController', () => {
  const admin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'admin@example.com',
    role: Role.Admin,
    status: UserStatus.Active,
  };

  const owner = {
    id: uuidOf(1),
    email: 'trader@example.com',
    telegramUsername: null,
    role: Role.Trader,
  } as User;

  const details = (overrides: Partial<BankDetails> = {}): BankDetails =>
    ({
      id: uuidOf(100),
      userId: uuidOf(1),
      user: owner,
      bankId: 1,
      bank: { id: 1, bankId: 'kaspi', name: 'Kaspi Bank' },
      type: TransactionType.Sbp,
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
      bannedBy: null,
      createdAt: new Date(),
      ...overrides,
    }) as BankDetails;

  const bankDetails = {
    list: jest.fn(),
    findById: jest.fn(),
    supervise: jest.fn(),
    delete: jest.fn(),
  };

  const query = (
    overrides: Record<string, unknown> = {},
  ): ListBankDetailsQueryDto =>
    plainToInstance(ListBankDetailsQueryDto, overrides);

  let controller: AdminBankDetailsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    bankDetails.list.mockResolvedValue(
      toPage([[details()], 1], { page: 1, limit: 20 }),
    );
    bankDetails.findById.mockResolvedValue(details());
    bankDetails.supervise.mockResolvedValue(details({ active: false }));

    const module = await Test.createTestingModule({
      controllers: [AdminBankDetailsController],
      providers: [{ provide: BankDetailsService, useValue: bankDetails }],
    }).compile();

    controller = module.get(AdminBankDetailsController);
  });

  it('is restricted to admins and superadmins', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminBankDetailsController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks supervising as a write', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminBankDetailsController.prototype.supervise,
      ),
    ).toBe(true);
  });

  it.each(['list', 'findOne'])(
    'leaves %s unmarked, so a suspended admin still reads',
    (handler) => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminBankDetailsController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );

  it('lists across every account, carrying the owner of each row', async () => {
    const listed = await controller.list(query());

    expect(bankDetails.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(listed.items[0]).toMatchObject({
      userId: uuidOf(1),
      user: { id: uuidOf(1), login: 'trader@example.com', role: Role.Trader },
    });
  });

  it('passes the owner filter through untouched', async () => {
    await controller.list(query({ userId: uuidOf(1), banned: 'true' }));

    expect(bankDetails.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: uuidOf(1), banned: true }),
    );
  });

  it('answers 404 for an id nobody holds', async () => {
    bankDetails.findById.mockResolvedValue(null);

    await expect(controller.findOne(uuidOf(404))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('reports who banned the details and when', async () => {
    const bannedAt = new Date();
    bankDetails.findById.mockResolvedValue(
      details({
        bannedAt,
        bannedBy: { ...owner, id: uuidOf(9), email: 'admin@example.com' },
      }),
    );

    await expect(controller.findOne(uuidOf(100))).resolves.toMatchObject({
      bannedAt,
      bannedBy: { id: uuidOf(9), login: 'admin@example.com' },
    });
  });

  it('hands the acting admin to the service, so a ban records its author', async () => {
    await controller.supervise(uuidOf(100), { banned: true }, admin);

    expect(bankDetails.supervise).toHaveBeenCalledWith(
      uuidOf(100),
      { banned: true },
      uuidOf(9),
    );
  });

  it('switches details on through the dedicated endpoint', async () => {
    await controller.enable(uuidOf(100), admin);

    expect(bankDetails.supervise).toHaveBeenCalledWith(
      uuidOf(100),
      { active: true },
      uuidOf(9),
    );
  });

  it('switches details off through the dedicated endpoint', async () => {
    await expect(controller.disable(uuidOf(100), admin)).resolves.toMatchObject(
      { active: false },
    );
    expect(bankDetails.supervise).toHaveBeenCalledWith(
      uuidOf(100),
      { active: false },
      uuidOf(9),
    );
  });

  it('deletes any account’s details', async () => {
    await controller.remove(uuidOf(100));

    expect(bankDetails.delete).toHaveBeenCalledWith(uuidOf(100));
  });

  it('has no way to switch active through the patch, so there is one route to it', () => {
    expect(
      validateSync(
        plainToInstance(SuperviseBankDetailsDto, { active: false }),
        { whitelist: true, forbidNonWhitelisted: true },
      ).map((error) => error.property),
    ).toEqual(['active']);
  });

  it.each(['enable', 'disable', 'remove'])('marks %s as a write', (handler) => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminBankDetailsController.prototype[handler],
      ),
    ).toBe(true);
  });

  it('refuses an empty patch rather than saving nothing', async () => {
    await expect(controller.supervise(uuidOf(100), {}, admin)).rejects.toThrow(
      BadRequestException,
    );
    expect(bankDetails.supervise).not.toHaveBeenCalled();
  });
});

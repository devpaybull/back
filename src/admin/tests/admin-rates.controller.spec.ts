import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ParseEnumPipe,
} from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { RateScope } from '../../transactions/types/rate-scope.enum';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { TRANSACTION_METHODS } from '../../transactions/utils/transaction-methods';
import { AdminRatesController } from '../controllers/admin-rates.controller';

describe('AdminRatesController', () => {
  const admin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'admin@example.com',
    role: Role.Admin,
    status: UserStatus.Active,
  };

  let rates: {
    getBaseSet: jest.Mock;
    replaceBaseSet: jest.Mock;
    getSubjectSet: jest.Mock;
    replaceSubjectSet: jest.Mock;
  };
  let directory: { findById: jest.Mock };
  let controller: AdminRatesController;

  beforeEach(() => {
    rates = {
      getBaseSet: jest.fn(async () => []),
      replaceBaseSet: jest.fn(async () => []),
      getSubjectSet: jest.fn(async () => []),
      replaceSubjectSet: jest.fn(async () => []),
    };
    directory = { findById: jest.fn() };
    controller = new AdminRatesController(rates as never, directory as never);
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminRatesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks the two replacements as writes and leaves reads unmarked', () => {
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.replaceBase),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.replaceSubject),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.readBase),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.readSubject),
    ).toBeUndefined();
  });

  describe('base rates', () => {
    it('replaces with the acting admin as actor', async () => {
      await controller.replaceBase(RateScope.Trader, { methods: [] }, admin);

      expect(rates.replaceBaseSet).toHaveBeenCalledWith(RateScope.Trader, [], {
        actorUserId: admin.id,
      });
    });
  });

  describe('individual rates', () => {
    it('404 when the user is unknown', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(controller.readSubject(uuidOf(1))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('400 when the user is neither trader nor lead trader', async () => {
      directory.findById.mockResolvedValue({ role: Role.Merchant } as User);

      await expect(controller.readSubject(uuidOf(1))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('answers 400 for a lead trader, who has no individual rates of its own', async () => {
      directory.findById.mockResolvedValue({ role: Role.LeadTrader } as User);

      await expect(controller.readSubject(uuidOf(1))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        controller.replaceSubject(uuidOf(1), { methods: [] }, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rates.getSubjectSet).not.toHaveBeenCalled();
      expect(rates.replaceSubjectSet).not.toHaveBeenCalled();
    });

    it('403 on self-edit', async () => {
      await expect(
        controller.replaceSubject(admin.id, { methods: [] }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('403 when the target outranks the admin', async () => {
      directory.findById.mockResolvedValue({ role: Role.Superadmin } as User);

      await expect(
        controller.replaceSubject(uuidOf(1), { methods: [] }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('replaces the trader set with the acting admin as actor', async () => {
      directory.findById.mockResolvedValue({ role: Role.Trader } as User);

      await controller.replaceSubject(uuidOf(1), { methods: [] }, admin);

      expect(rates.replaceSubjectSet).toHaveBeenCalledWith(
        RateScope.Trader,
        uuidOf(1),
        [],
        { actorUserId: admin.id },
      );
    });

    it('passes bands and bank rows through, treating absent lists as empty', async () => {
      directory.findById.mockResolvedValue({ role: Role.Trader } as User);
      const bank = { bankId: 3, payInPercent: 5, payOutPercent: 2 };

      await controller.replaceSubject(
        uuidOf(1),
        {
          methods: [
            { method: 'sbp' },
            { method: 'card', general: null, bands: [], banks: [bank] },
          ],
        },
        admin,
      );

      expect(rates.replaceSubjectSet).toHaveBeenCalledWith(
        RateScope.Trader,
        uuidOf(1),
        [
          { method: 'sbp', general: null, bands: [], banks: [] },
          { method: 'card', general: null, bands: [], banks: [bank] },
        ],
        { actorUserId: admin.id },
      );
    });

    it('answers with bank rows in the read-back set', async () => {
      directory.findById.mockResolvedValue({ role: Role.Trader } as User);
      rates.getSubjectSet.mockResolvedValue([
        {
          method: 'card',
          bankId: 3,
          fromAmount: null,
          toAmount: null,
          payInPercent: 5,
          payOutPercent: 2,
        },
      ]);

      await expect(controller.readSubject(uuidOf(1))).resolves.toEqual({
        methods: [
          {
            method: 'card',
            general: null,
            bands: [],
            banks: [{ bankId: 3, payInPercent: 5, payOutPercent: 2 }],
          },
        ],
      });
    });
  });

  describe('the scope of a base set', () => {
    it('knows only trader and merchant: lead is gone', () => {
      expect(Object.values(RateScope)).toEqual([
        RateScope.Trader,
        RateScope.Merchant,
      ]);
    });

    it('answers 400 to the lead scope on the base endpoints', async () => {
      await expect(
        new ParseEnumPipe(RateScope).transform('lead' as never, {
          type: 'param',
          data: 'scope',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('GET /admin/methods', () => {
    it('lists the registry as code, currency and rate kind', () => {
      expect(controller.listMethods()).toEqual(
        TRANSACTION_METHODS.map((method) => ({
          code: method.code,
          currency: method.currency,
          rateKind: method.rateKind,
        })),
      );
      expect(controller.listMethods()[0]).toEqual({
        code: 'sbp',
        currency: 'RUB',
        rateKind: 'by_amount',
      });
    });

    it('is a read, open to admin and superadmin through the class guard', () => {
      expect(
        Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.listMethods),
      ).toBeUndefined();
    });
  });
});

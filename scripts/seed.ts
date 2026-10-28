import Decimal from 'decimal.js';
import 'dotenv/config';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { loginOf } from '../src/common/utils/login-of';
import { sha256Hex } from '../src/common/utils/sha256-hex';
import { Role } from '../src/common/enums/role.enum';
import { TransactionType } from '../src/common/enums/transaction-type.enum';
import { Country } from '../src/countries/entities/country.entity';
import { Currency } from '../src/currencies/entities/currency.entity';
import { Bank } from '../src/banks/entities/bank.entity';
import { Device } from '../src/devices/entities/device.entity';
import { DeviceModel } from '../src/devices/types/device-model.enum';
import { DeviceStatus } from '../src/devices/types/device-status.enum';
import { BankDetails } from '../src/bank-details/entities/bank-details.entity';
import { User } from '../src/users/entities/user.entity';
import { TraderLead } from '../src/users/entities/trader-lead.entity';
import { UserBackupCode } from '../src/users/entities/user-backup-code.entity';
import { UserStatus } from '../src/users/types/user-status.enum';
import { Merchant } from '../src/merchants/entities/merchant.entity';
import { MerchantApiKey } from '../src/merchants/entities/merchant-api-key.entity';
import { Counterparty } from '../src/counterparties/entities/counterparty.entity';
import { AccountTransaction } from '../src/account-transactions/entities/account-transaction.entity';
import { AccountTransactionStatus } from '../src/account-transactions/types/account-transaction-status.enum';
import { AccountTransactionType } from '../src/account-transactions/types/account-transaction-type.enum';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { BalanceOperation } from '../src/transactions/entities/balance-operation.entity';
import { BalanceKind } from '../src/transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../src/transactions/types/balance-operation-type.enum';
import { LeadRate } from '../src/transactions/entities/lead-rate.entity';
import { MerchantBalance } from '../src/transactions/entities/merchant-balance.entity';
import { MerchantBalanceOperation } from '../src/transactions/entities/merchant-balance-operation.entity';
import { MerchantBalanceOperationType } from '../src/transactions/types/merchant-balance-operation-type.enum';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { TransactionLeadShare } from '../src/transactions/entities/transaction-lead-share.entity';
import {
  DealLeadPercent,
  DealLeadShare,
} from '../src/transactions/types/deal-computation';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { TransactionMethod } from '../src/transactions/types/transaction-method';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { TransactionKind } from '../src/transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../src/transactions/types/transaction-status.enum';
import { TransactionStatusEvent } from '../src/transactions/entities/transaction-status-event.entity';
import { StatusEventSource } from '../src/transactions/types/status-event-source.enum';
import { computeDeal } from '../src/transactions/utils/compute-deal';
import { formatCrypto } from '../src/common/utils/format-crypto';
import { roundCrypto } from '../src/common/utils/round-crypto';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toFiat } from '../src/common/utils/to-fiat';
import { toRate } from '../src/common/utils/to-rate';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { AuditSource } from '../src/audit/types/audit-source.enum';
import { Debt } from '../src/debts/entities/debt.entity';
import { DebtEvent } from '../src/debts/entities/debt-event.entity';
import { DebtEventType } from '../src/debts/types/debt-event-type.enum';

const BASE32_SECRET = /^[A-Z2-7]{16,}$/;

const fromEnv = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim();

  return value ? value : fallback;
};

const SEED_PASSWORD = fromEnv('SEED_PASSWORD', 'TestPass123!');
const SEED_TOTP_SECRET = fromEnv(
  'SEED_TOTP_SECRET',
  'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
);

if (!BASE32_SECRET.test(SEED_TOTP_SECRET)) {
  throw new Error(
    'SEED_TOTP_SECRET must be base32 (A-Z, 2-7), at least 16 characters',
  );
}
const MARKER_EMAIL = 'superadmin@example.com';

const platformMinPercent = (): number => {
  const raw = process.env.PLATFORM_MIN_PERCENT ?? '';
  const value = Number(raw);

  if (raw.trim() === '' || !Number.isFinite(value) || value < 0) {
    throw new Error('PLATFORM_MIN_PERCENT must be set to seed deals');
  }

  return value;
};

const dealTtlMinutes = (): number => {
  const raw = process.env.DEAL_TTL_MINUTES ?? '';
  const value = Number(raw);

  if (raw.trim() === '' || !Number.isInteger(value) || value < 1) {
    throw new Error('DEAL_TTL_MINUTES must be set to seed deals');
  }

  return value;
};

interface StatusStep {
  toStatus: TransactionStatus;
  source: StatusEventSource;
  actorUserId?: string | null;
  reason?: string | null;
}

interface SeededUser {
  user: User;
  codes: string[];
}

const daysAgo = (days: number): Date =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function issueBackupCodes(
  manager: EntityManager,
  userId: string,
): Promise<string[]> {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(5).toString('hex').toUpperCase(),
  );

  await manager.save(
    UserBackupCode,
    codes.map((code) =>
      manager.create(UserBackupCode, { userId, codeHash: sha256Hex(code) }),
    ),
  );

  return codes.map((code) => `${code.slice(0, 5)}-${code.slice(5)}`);
}

async function seedUser(
  manager: EntityManager,
  passwordHash: string,
  input: {
    email?: string;
    telegramUsername: string;
    emailVerified?: boolean;
    role: Role;
    status: UserStatus;
    withBackupCodes?: boolean;
    merchantId?: string;
  },
): Promise<SeededUser> {
  const user = await manager.save(
    User,
    manager.create(User, {
      email: input.email ?? null,
      emailVerified: input.emailVerified ?? false,
      telegramUsername: input.telegramUsername,
      passwordHash,
      role: input.role,
      merchantId: input.merchantId ?? null,
      status: input.status,
      totpSecret: SEED_TOTP_SECRET,
      twoFactorConfirmedAt: daysAgo(30),
    }),
  );

  const codes = input.withBackupCodes
    ? await issueBackupCodes(manager, user.id)
    : [];

  return { user, codes };
}

async function recordBalanceMove(
  manager: EntityManager,
  wallet: Wallet,
  balanceKind: BalanceKind,
  delta: Decimal.Value,
  type: BalanceOperationType,
  transactionId: string | null,
  accountTransactionId: number | null = null,
): Promise<BalanceOperation> {
  const field =
    balanceKind === BalanceKind.Main
      ? 'mainBalance'
      : balanceKind === BalanceKind.InsurancePayIn
        ? 'insurancePayInBalance'
        : 'insurancePayOutBalance';

  const before = toCrypto(wallet[field] ?? 0);
  const after = roundCrypto(before.plus(delta));
  wallet[field] = after;

  return manager.save(
    BalanceOperation,
    manager.create(BalanceOperation, {
      walletId: wallet.id,
      type,
      balanceKind,
      transactionId,
      accountTransactionId,
      amount: roundCrypto(delta),
      balanceBefore: before,
      balanceAfter: after,
    }),
  );
}

async function recordMerchantMove(
  manager: EntityManager,
  balance: MerchantBalance,
  type: MerchantBalanceOperationType,
  transactionId: string | null,
  balanceDelta: Decimal.Value,
  escrowDelta: Decimal.Value,
  extra: { comment?: string; actorUserId?: string } = {},
): Promise<MerchantBalanceOperation> {
  const before = toCrypto(balance.balance ?? 0);
  const after = roundCrypto(before.plus(balanceDelta));
  const escrowBefore = toCrypto(balance.escrow ?? 0);
  const escrowAfter = roundCrypto(escrowBefore.plus(escrowDelta));
  balance.balance = after;
  balance.escrow = escrowAfter;

  return manager.save(
    MerchantBalanceOperation,
    manager.create(MerchantBalanceOperation, {
      merchantBalanceId: balance.id,
      type,
      transactionId,
      amount: roundCrypto(after.minus(before)),
      balanceBefore: before,
      balanceAfter: after,
      escrowBefore,
      escrowAfter,
      comment: extra.comment ?? null,
      actorUserId: extra.actorUserId ?? null,
    }),
  );
}

async function writeStatusPath(
  manager: EntityManager,
  transactionId: string,
  steps: StatusStep[],
): Promise<void> {
  let from: TransactionStatus | null = null;

  for (const step of steps) {
    await manager.save(
      TransactionStatusEvent,
      manager.create(TransactionStatusEvent, {
        transactionId,
        fromStatus: from,
        toStatus: step.toStatus,
        source: step.source,
        actorUserId: step.actorUserId ?? null,
        reason: step.reason ?? null,
      }),
    );
    from = step.toStatus;
  }
}

async function createDeal(
  manager: EntityManager,
  input: {
    kind: TransactionKind.PayIn | TransactionKind.PayOut;
    method: TransactionMethod;
    traderUserId: string;
    bankDetailsId: string;
    merchantId: string;
    counterpartyId?: number | null;
    amountFiat: number;
    rate: number;
    merchantPercent: number;
    traderPercent: number;
    leads?: DealLeadPercent[];
    comment?: string;
    steps: StatusStep[];
    finalStatus: TransactionStatus;
    resolved: boolean;
  },
): Promise<Transaction & { leadShares: DealLeadShare[] }> {
  const amountFiat = toFiat(input.amountFiat);
  const rate = toRate(input.rate);
  const computation = computeDeal({
    kind: input.kind,
    amountFiat,
    rate,
    merchantPercent: input.merchantPercent,
    traderPercent: input.traderPercent,
    platformMinPercent: platformMinPercent(),
    leads: input.leads ?? [],
  });

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + dealTtlMinutes() * 60_000);

  const transaction = await manager.save(
    Transaction,
    manager.create(Transaction, {
      kind: input.kind,
      status: input.finalStatus,
      method: input.method,
      traderUserId: input.traderUserId,
      bankDetailsId: input.bankDetailsId,
      merchantId: input.merchantId,
      counterpartyId: input.counterpartyId ?? null,
      amountFiat,
      amountCrypto: computation.amountCrypto,
      rate,
      merchantPercent: input.merchantPercent,
      traderPercent: input.traderPercent,
      traderEffectivePercent: computation.traderEffectivePercent,
      leadPercent: computation.leadPercent,
      merchantCommission: computation.merchantCommission,
      traderCommission: computation.traderCommission,
      leadCommission: computation.leadCommission,
      traderAmount: computation.traderAmount,
      merchantAmount: computation.merchantAmount,
      comment: input.comment ?? null,
      createdAt,
      expiresAt,
      resolvedAt: input.resolved ? new Date() : null,
    }),
  );

  if (computation.leadShares.length) {
    await manager.save(
      TransactionLeadShare,
      computation.leadShares.map((share) =>
        manager.create(TransactionLeadShare, {
          transactionId: transaction.id,
          leadUserId: share.leadUserId,
          percent: share.percent,
          amount: share.amount,
        }),
      ),
    );
  }

  await writeStatusPath(manager, transaction.id, input.steps);

  return {
    ...transaction,
    traderAmount: computation.traderAmount,
    leadShares: computation.leadShares,
  } as Transaction & { leadShares: DealLeadShare[] };
}

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: false,
    entities: [join(__dirname, '../src/**/*.entity.ts')],
  });

  await dataSource.initialize();

  const existing = await dataSource.manager.findOne(User, {
    where: { email: MARKER_EMAIL },
  });

  if (existing) {
    console.log(
      `Seed data already present (${MARKER_EMAIL} exists). Aborting without changes.`,
    );
    await dataSource.destroy();
    return;
  }

  const passwordHash = await hash(SEED_PASSWORD, 12);
  const credentials: { label: string; user: SeededUser }[] = [];

  await dataSource.transaction(async (manager) => {
    const russia = await manager.save(
      Country,
      manager.create(Country, { name: 'Россия' }),
    );
    const rub = await manager.save(
      Currency,
      manager.create(Currency, {
        name: 'Российский рубль',
        isocode: 'RUB',
        countryId: russia.id,
      }),
    );

    const sberbank = await manager.save(
      Bank,
      manager.create(Bank, {
        bankId: 'sberbank',
        name: 'Сбербанк',
        code: 'SBER',
        countryId: russia.id,
        currencyId: rub.id,
        transactionTypes: [TransactionType.Card, TransactionType.Sbp],
        active: true,
        automatic: true,
      }),
    );
    const tinkoff = await manager.save(
      Bank,
      manager.create(Bank, {
        bankId: 'tinkoff',
        name: 'Т-Банк',
        countryId: russia.id,
        currencyId: rub.id,
        transactionTypes: [TransactionType.Sbp],
        active: true,
        automatic: false,
      }),
    );

    const superadmin = await seedUser(manager, passwordHash, {
      email: MARKER_EMAIL,
      telegramUsername: 'superadmin',
      emailVerified: true,
      role: Role.Superadmin,
      status: UserStatus.Active,
      withBackupCodes: true,
    });
    credentials.push({ label: 'Superadmin', user: superadmin });

    const admin = await seedUser(manager, passwordHash, {
      email: 'admin@example.com',
      telegramUsername: 'admin_main',
      emailVerified: true,
      role: Role.Admin,
      status: UserStatus.Active,
      withBackupCodes: true,
    });
    credentials.push({ label: 'Admin', user: admin });

    const trader1 = await seedUser(manager, passwordHash, {
      email: 'trader1@example.com',
      telegramUsername: 'trader_one',
      emailVerified: true,
      role: Role.Trader,
      status: UserStatus.Active,
      withBackupCodes: true,
    });
    credentials.push({ label: 'Trader 1 (rich test data)', user: trader1 });

    const trader2 = await seedUser(manager, passwordHash, {
      email: 'trader2@example.com',
      telegramUsername: 'trader_two',
      emailVerified: false,
      role: Role.Trader,
      status: UserStatus.Suspended,
      withBackupCodes: true,
    });
    credentials.push({ label: 'Trader 2 (suspended)', user: trader2 });

    const trader3 = await seedUser(manager, passwordHash, {
      telegramUsername: 'trader3_tg',
      role: Role.Trader,
      status: UserStatus.Active,
      withBackupCodes: true,
    });
    credentials.push({ label: 'Trader 3 (telegram-only)', user: trader3 });

    const lead1 = await seedUser(manager, passwordHash, {
      email: 'lead1@example.com',
      telegramUsername: 'lead_one',
      emailVerified: true,
      role: Role.LeadTrader,
      status: UserStatus.Active,
      withBackupCodes: true,
    });
    credentials.push({ label: 'Lead trader', user: lead1 });

    const merchantRoleEmail = 'merchant.role@example.com';
    const merchantRoleMerchant = await manager.save(
      Merchant,
      manager.create(Merchant, { name: 'merchant_role', active: true }),
    );
    const merchantRoleUser = await seedUser(manager, passwordHash, {
      email: merchantRoleEmail,
      telegramUsername: 'merchant_role',
      emailVerified: true,
      role: Role.Merchant,
      status: UserStatus.Active,
      withBackupCodes: true,
      merchantId: merchantRoleMerchant.id,
    });
    credentials.push({
      label: 'Merchant-role account',
      user: merchantRoleUser,
    });

    const merchantSupport = await seedUser(manager, passwordHash, {
      email: 'merchant.support@example.com',
      telegramUsername: 'merchant_support',
      emailVerified: true,
      role: Role.MerchantSupport,
      status: UserStatus.Active,
      withBackupCodes: true,
      merchantId: merchantRoleMerchant.id,
    });
    credentials.push({ label: 'Merchant support', user: merchantSupport });

    const merchantAgent = await seedUser(manager, passwordHash, {
      telegramUsername: 'merchant_agent_tg',
      role: Role.MerchantAgent,
      status: UserStatus.Active,
      withBackupCodes: true,
      merchantId: merchantRoleMerchant.id,
    });
    credentials.push({
      label: 'Merchant agent (telegram-only)',
      user: merchantAgent,
    });

    const [trader1Lead1] = await manager.save(TraderLead, [
      manager.create(TraderLead, {
        traderUserId: trader1.user.id,
        leadUserId: lead1.user.id,
        currencyId: rub.id,
        payInPercent: 0.5,
        payOutPercent: 0.2,
      }),
      manager.create(TraderLead, {
        traderUserId: trader3.user.id,
        leadUserId: lead1.user.id,
        currencyId: rub.id,
        payInPercent: 0.4,
        payOutPercent: 0.1,
      }),
    ]);
    await manager.save(LeadRate, [
      manager.create(LeadRate, {
        traderLeadId: trader1Lead1.id,
        method: 'sbp',
        payInPercent: 0.4,
        payOutPercent: 0.15,
      }),
      manager.create(LeadRate, {
        traderLeadId: trader1Lead1.id,
        method: 'sbp',
        fromAmount: toFiat(1000),
        toAmount: toFiat(5000),
        payInPercent: 0.3,
        payOutPercent: 0.1,
      }),
    ]);

    const blocked1 = await seedUser(manager, passwordHash, {
      email: 'blocked1@example.com',
      telegramUsername: 'blocked_one',
      emailVerified: true,
      role: Role.Trader,
      status: UserStatus.Blocked,
      withBackupCodes: false,
    });
    credentials.push({
      label: 'Blocked trader (cannot log in)',
      user: blocked1,
    });

    const device1 = await manager.save(
      Device,
      manager.create(Device, {
        userId: trader1.user.id,
        name: 'Pixel 7',
        status: DeviceStatus.On,
        model: DeviceModel.Android,
      }),
    );
    await manager.save(
      Device,
      manager.create(Device, {
        userId: trader1.user.id,
        name: 'Redmi Note 12',
        status: DeviceStatus.Off,
      }),
    );

    const bd1 = await manager.save(
      BankDetails,
      manager.create(BankDetails, {
        userId: trader1.user.id,
        bankId: sberbank.id,
        deviceId: device1.id,
        type: TransactionType.Card,
        cardholderName: 'IVAN PETROV',
        card: '4276000011112222',
        minAmountEnabled: true,
        minAmount: toFiat(500),
        maxAmountEnabled: true,
        maxAmount: toFiat(50000),
        dailyLimitEnabled: true,
        dailyLimit: 20,
        active: true,
      }),
    );
    const bd2 = await manager.save(
      BankDetails,
      manager.create(BankDetails, {
        userId: trader1.user.id,
        bankId: tinkoff.id,
        deviceId: device1.id,
        type: TransactionType.Sbp,
        phone: '+79261234567',
        monthlyAmountLimitEnabled: true,
        monthlyAmountLimit: toFiat(1000000),
        active: true,
      }),
    );
    await manager.save(
      BankDetails,
      manager.create(BankDetails, {
        userId: trader1.user.id,
        bankId: sberbank.id,
        type: TransactionType.Card,
        card: '4276000033334444',
        counterpartyOnly: true,
        minAmountEnabled: true,
        reserve: true,
        active: true,
      }),
    );
    await manager.save(
      BankDetails,
      manager.create(BankDetails, {
        userId: trader1.user.id,
        bankId: tinkoff.id,
        type: TransactionType.Sbp,
        phone: '+79267654321',
        active: true,
        bannedAt: new Date(),
        bannedByUserId: admin.user.id,
      }),
    );

    const merchant1 = await manager.save(
      Merchant,
      manager.create(Merchant, { name: 'Ohla Shop', active: true }),
    );
    const merchant2 = await manager.save(
      Merchant,
      manager.create(Merchant, { name: 'Payzavr Store', active: false }),
    );
    const merchant1Balance = await manager.save(
      MerchantBalance,
      manager.create(MerchantBalance, { merchantId: merchant1.id }),
    );
    await recordMerchantMove(
      manager,
      merchant1Balance,
      MerchantBalanceOperationType.AdminAdjustment,
      null,
      1000,
      0,
      { comment: 'Стартовый баланс', actorUserId: superadmin.user.id },
    );

    await manager.save(
      MerchantApiKey,
      manager.create(MerchantApiKey, {
        merchantId: merchant1.id,
        key: 'ohla-shop-live-key',
        secret: randomBytes(32).toString('hex'),
        active: true,
      }),
    );
    await manager.save(
      MerchantApiKey,
      manager.create(MerchantApiKey, {
        merchantId: merchant2.id,
        key: 'payzavr-store-old-key',
        secret: randomBytes(32).toString('hex'),
        active: false,
        revokedAt: daysAgo(5),
      }),
    );

    const cp1 = await manager.save(
      Counterparty,
      manager.create(Counterparty, {
        merchantId: merchant1.id,
        externalId: 'cust-1001',
        name: 'Sergey K.',
        contact: '+79161112233',
      }),
    );
    const cp2 = await manager.save(
      Counterparty,
      manager.create(Counterparty, {
        merchantId: merchant1.id,
        externalId: 'cust-1002',
        name: 'Olga M.',
        contact: 'olga@example.com',
        payload: { note: 'VIP' },
      }),
    );

    const trader1Wallet = await manager.save(
      Wallet,
      manager.create(Wallet, { userId: trader1.user.id }),
    );
    const lead1Wallet = await manager.save(
      Wallet,
      manager.create(Wallet, { userId: lead1.user.id }),
    );
    const trader2Wallet = await manager.save(
      Wallet,
      manager.create(Wallet, { userId: trader2.user.id }),
    );
    const trader3Wallet = await manager.save(
      Wallet,
      manager.create(Wallet, { userId: trader3.user.id }),
    );

    await recordBalanceMove(
      manager,
      trader1Wallet,
      BalanceKind.Main,
      1000,
      BalanceOperationType.AdminAdjustment,
      null,
    );
    await recordBalanceMove(
      manager,
      trader1Wallet,
      BalanceKind.InsurancePayIn,
      800,
      BalanceOperationType.AdminAdjustment,
      null,
    );
    await recordBalanceMove(
      manager,
      trader1Wallet,
      BalanceKind.InsurancePayOut,
      300,
      BalanceOperationType.AdminAdjustment,
      null,
    );
    trader1Wallet.lastAcceptedDealAt = new Date();

    await recordBalanceMove(
      manager,
      lead1Wallet,
      BalanceKind.Main,
      200,
      BalanceOperationType.AdminAdjustment,
      null,
    );

    await recordBalanceMove(
      manager,
      trader2Wallet,
      BalanceKind.Main,
      150,
      BalanceOperationType.AdminAdjustment,
      null,
    );

    await recordBalanceMove(
      manager,
      trader3Wallet,
      BalanceKind.Main,
      300,
      BalanceOperationType.AdminAdjustment,
      null,
    );
    await recordBalanceMove(
      manager,
      trader3Wallet,
      BalanceKind.InsurancePayIn,
      500,
      BalanceOperationType.AdminAdjustment,
      null,
    );
    trader3Wallet.lastAcceptedDealAt = daysAgo(20);

    const d1 = await createDeal(manager, {
      kind: TransactionKind.PayIn,
      method: 'card',
      traderUserId: trader1.user.id,
      bankDetailsId: bd1.id,
      merchantId: merchant1.id,
      counterpartyId: cp1.id,
      amountFiat: 26262,
      rate: 88.92,
      merchantPercent: 10.5,
      traderPercent: 9.0,
      leads: [{ leadUserId: lead1.user.id, percent: 0.5 }],
      comment: 'Оплата картой',
      finalStatus: TransactionStatus.Success,
      resolved: true,
      steps: [
        {
          toStatus: TransactionStatus.Active,
          source: StatusEventSource.System,
        },
        {
          toStatus: TransactionStatus.Success,
          source: StatusEventSource.System,
        },
      ],
    });
    await recordBalanceMove(
      manager,
      trader1Wallet,
      BalanceKind.Main,
      d1.traderAmount.neg(),
      BalanceOperationType.Transaction,
      d1.id,
    );
    await recordMerchantMove(
      manager,
      merchant1Balance,
      MerchantBalanceOperationType.DealPayIn,
      d1.id,
      d1.merchantAmount,
      0,
    );
    for (const share of d1.leadShares) {
      await recordBalanceMove(
        manager,
        lead1Wallet,
        BalanceKind.Main,
        share.amount,
        BalanceOperationType.Transaction,
        d1.id,
      );
    }

    const d2 = await createDeal(manager, {
      kind: TransactionKind.PayIn,
      method: 'sbp',
      traderUserId: trader1.user.id,
      bankDetailsId: bd2.id,
      merchantId: merchant1.id,
      counterpartyId: cp2.id,
      amountFiat: 9500,
      rate: 89.5,
      merchantPercent: 10.5,
      traderPercent: 8.5,
      leads: [{ leadUserId: lead1.user.id, percent: 0.4 }],
      finalStatus: TransactionStatus.Active,
      resolved: false,
      steps: [
        {
          toStatus: TransactionStatus.Active,
          source: StatusEventSource.System,
        },
      ],
    });
    trader1Wallet.mainReserved = roundCrypto(
      toCrypto(trader1Wallet.mainReserved ?? 0).plus(d2.traderAmount),
    );

    const d3 = await createDeal(manager, {
      kind: TransactionKind.PayIn,
      method: 'card',
      traderUserId: trader1.user.id,
      bankDetailsId: bd1.id,
      merchantId: merchant1.id,
      counterpartyId: cp1.id,
      amountFiat: 12000,
      rate: 89.0,
      merchantPercent: 10.5,
      traderPercent: 9.0,
      finalStatus: TransactionStatus.ManualReview,
      resolved: false,
      steps: [
        {
          toStatus: TransactionStatus.Active,
          source: StatusEventSource.System,
        },
        {
          toStatus: TransactionStatus.Dispute,
          source: StatusEventSource.Trader,
          actorUserId: trader1.user.id,
          reason: 'Клиент утверждает, что перевод не получен',
        },
        {
          toStatus: TransactionStatus.ManualReview,
          source: StatusEventSource.System,
        },
      ],
    });
    trader1Wallet.mainReserved = roundCrypto(
      toCrypto(trader1Wallet.mainReserved ?? 0).plus(d3.traderAmount),
    );

    await createDeal(manager, {
      kind: TransactionKind.PayIn,
      method: 'sbp',
      traderUserId: trader1.user.id,
      bankDetailsId: bd2.id,
      merchantId: merchant1.id,
      amountFiat: 3000,
      rate: 89.5,
      merchantPercent: 10.5,
      traderPercent: 8.5,
      finalStatus: TransactionStatus.Canceled,
      resolved: true,
      steps: [
        {
          toStatus: TransactionStatus.Active,
          source: StatusEventSource.System,
        },
        {
          toStatus: TransactionStatus.Canceled,
          source: StatusEventSource.AutoTimer,
          reason: 'Истекло время ожидания оплаты',
        },
      ],
    });

    const d5 = await createDeal(manager, {
      kind: TransactionKind.PayOut,
      method: 'card',
      traderUserId: trader1.user.id,
      bankDetailsId: bd1.id,
      merchantId: merchant1.id,
      counterpartyId: cp2.id,
      amountFiat: 40000,
      rate: 89.05,
      merchantPercent: 3,
      traderPercent: 1.5,
      finalStatus: TransactionStatus.Success,
      resolved: true,
      steps: [
        {
          toStatus: TransactionStatus.Pending,
          source: StatusEventSource.System,
        },
        {
          toStatus: TransactionStatus.Active,
          source: StatusEventSource.Trader,
          actorUserId: trader1.user.id,
        },
        {
          toStatus: TransactionStatus.Success,
          source: StatusEventSource.System,
        },
      ],
    });
    await recordBalanceMove(
      manager,
      trader1Wallet,
      BalanceKind.Main,
      d5.traderAmount,
      BalanceOperationType.Transaction,
      d5.id,
    );
    await recordMerchantMove(
      manager,
      merchant1Balance,
      MerchantBalanceOperationType.DealPayOutEscrow,
      d5.id,
      d5.merchantAmount.neg(),
      d5.merchantAmount,
    );
    await recordMerchantMove(
      manager,
      merchant1Balance,
      MerchantBalanceOperationType.DealPayOut,
      d5.id,
      0,
      d5.merchantAmount.neg(),
    );

    const d6 = await createDeal(manager, {
      kind: TransactionKind.PayOut,
      method: 'sbp',
      traderUserId: trader1.user.id,
      bankDetailsId: bd2.id,
      merchantId: merchant1.id,
      amountFiat: 7000,
      rate: 89.2,
      merchantPercent: 3,
      traderPercent: 1.5,
      finalStatus: TransactionStatus.Pending,
      resolved: false,
      steps: [
        {
          toStatus: TransactionStatus.Pending,
          source: StatusEventSource.System,
        },
      ],
    });

    await recordMerchantMove(
      manager,
      merchant1Balance,
      MerchantBalanceOperationType.DealPayOutEscrow,
      d6.id,
      d6.merchantAmount.neg(),
      d6.merchantAmount,
    );

    const transferAmount = toCrypto(50);
    const transfer = await manager.save(
      AccountTransaction,
      manager.create(AccountTransaction, {
        type: AccountTransactionType.Transfer,
        status: AccountTransactionStatus.Completed,
        userId: trader1.user.id,
        counterpartyUserId: lead1.user.id,
        amount: transferAmount,
        comment: 'Комиссия лида за месяц',
        actorUserId: admin.user.id,
        completedAt: new Date(),
      }),
    );
    await recordBalanceMove(
      manager,
      trader1Wallet,
      BalanceKind.Main,
      transferAmount.neg(),
      BalanceOperationType.Internal,
      null,
      transfer.id,
    );
    await recordBalanceMove(
      manager,
      lead1Wallet,
      BalanceKind.Main,
      transferAmount,
      BalanceOperationType.Internal,
      null,
      transfer.id,
    );

    const debtIssued = await recordBalanceMove(
      manager,
      trader2Wallet,
      BalanceKind.Main,
      400,
      BalanceOperationType.DebtIssued,
      null,
    );
    const partialDebt = await manager.save(
      Debt,
      manager.create(Debt, {
        userId: trader2.user.id,
        issuedByUserId: superadmin.user.id,
        amount: toCrypto(400),
        remaining: toCrypto(300),
        comment: 'Вернёт до конца месяца',
      }),
    );
    const debtWithheld = await recordBalanceMove(
      manager,
      trader2Wallet,
      BalanceKind.Main,
      -100,
      BalanceOperationType.DebtWriteOff,
      null,
    );
    await manager.save(DebtEvent, [
      manager.create(DebtEvent, {
        debtId: partialDebt.id,
        type: DebtEventType.Issued,
        amount: toCrypto(400),
        actorUserId: superadmin.user.id,
        balanceOperationId: debtIssued.id,
      }),
      manager.create(DebtEvent, {
        debtId: partialDebt.id,
        type: DebtEventType.ManualWriteOff,
        amount: toCrypto(100),
        actorUserId: superadmin.user.id,
        balanceOperationId: debtWithheld.id,
      }),
    ]);

    const scheduledIssued = await recordBalanceMove(
      manager,
      trader3Wallet,
      BalanceKind.Main,
      250,
      BalanceOperationType.DebtIssued,
      null,
    );
    const scheduledDebt = await manager.save(
      Debt,
      manager.create(Debt, {
        userId: trader3.user.id,
        issuedByUserId: superadmin.user.id,
        amount: toCrypto(250),
        remaining: toCrypto(250),
        autoWriteOffAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    await manager.save(
      DebtEvent,
      manager.create(DebtEvent, {
        debtId: scheduledDebt.id,
        type: DebtEventType.Issued,
        amount: toCrypto(250),
        actorUserId: superadmin.user.id,
        balanceOperationId: scheduledIssued.id,
      }),
    );

    await manager.save([
      trader1Wallet,
      lead1Wallet,
      trader2Wallet,
      trader3Wallet,
    ]);
    await manager.save(merchant1Balance);

    await manager.save(
      TraderSettings,
      manager.create(TraderSettings, {
        userId: trader1.user.id,
        tradingEnabled: true,
        payoutTradingEnabled: true,
        individualRatesEnabled: true,
        autoBuybackEnabled: true,
        autoBuybackConcurrent: 3,
        payInAntifraudEnabled: true,
        trustedUser: true,
        insurancePayInMin: 1000,
      }),
    );
    await manager.save(
      TraderSettings,
      manager.create(TraderSettings, { userId: trader2.user.id }),
    );
    await manager.save(
      TraderSettings,
      manager.create(TraderSettings, {
        userId: trader3.user.id,
        tradingEnabled: true,
      }),
    );
    await manager.save(
      TraderSettings,
      manager.create(TraderSettings, {
        userId: lead1.user.id,
        individualRatesEnabled: true,
      }),
    );

    const baseRates: {
      scope: RateScope;
      rows: {
        method: TransactionMethod;
        payInPercent: number;
        payOutPercent: number;
      }[];
    }[] = [
      {
        scope: RateScope.Trader,
        rows: [
          { method: 'sbp', payInPercent: 8.5, payOutPercent: 1.5 },
          { method: 'card', payInPercent: 9.0, payOutPercent: 2.0 },
          {
            method: 'counterparty',
            payInPercent: 6.0,
            payOutPercent: 0,
          },
          {
            method: 'mobile_commerce',
            payInPercent: 10.0,
            payOutPercent: 0,
          },
        ],
      },
      {
        scope: RateScope.Merchant,
        rows: [
          { method: 'sbp', payInPercent: 10.5, payOutPercent: 3.0 },
          { method: 'card', payInPercent: 11.0, payOutPercent: 3.5 },
          {
            method: 'counterparty',
            payInPercent: 8.0,
            payOutPercent: 0,
          },
          {
            method: 'mobile_commerce',
            payInPercent: 12.0,
            payOutPercent: 0,
          },
        ],
      },
    ];

    for (const group of baseRates) {
      await manager.save(
        MethodRate,
        group.rows.map((row) =>
          manager.create(MethodRate, {
            scope: group.scope,
            method: row.method,
            payInPercent: row.payInPercent,
            payOutPercent: row.payOutPercent,
          }),
        ),
      );
    }

    await manager.save(MethodRate, [
      manager.create(MethodRate, {
        scope: RateScope.Trader,
        method: 'sbp',
        subjectUserId: trader1.user.id,
        payInPercent: 8.0,
        payOutPercent: 1.2,
      }),
      manager.create(MethodRate, {
        scope: RateScope.Trader,
        method: 'sbp',
        subjectUserId: trader1.user.id,
        fromAmount: 1000,
        toAmount: 5000,
        payInPercent: 7.0,
        payOutPercent: 1.0,
      }),
      manager.create(MethodRate, {
        scope: RateScope.Trader,
        method: 'card',
        subjectUserId: trader1.user.id,
        payInPercent: 8.5,
        payOutPercent: 1.8,
      }),
    ]);

    await manager.save(AuditLog, [
      manager.create(AuditLog, {
        source: AuditSource.Domain,
        actorUserId: admin.user.id,
        targetUserId: lead1.user.id,
        action: 'user.transfer',
        metadata: {
          transactionId: transfer.id,
          fromUserId: trader1.user.id,
          toUserId: lead1.user.id,
          amount: formatCrypto(toCrypto(50)),
        },
      }),
      manager.create(AuditLog, {
        source: AuditSource.Domain,
        actorUserId: admin.user.id,
        targetUserId: trader1.user.id,
        action: 'trader_settings.auto_buyback_changed',
        reason: 'Включено по просьбе трейдера',
        metadata: { autoBuybackEnabled: true, autoBuybackConcurrent: 3 },
      }),
      manager.create(AuditLog, {
        source: AuditSource.Domain,
        actorUserId: superadmin.user.id,
        action: 'rates.updated',
        metadata: { scope: RateScope.Trader },
      }),
      manager.create(AuditLog, {
        source: AuditSource.Http,
        actorUserId: null,
        action: 'POST /auth/login',
        method: 'POST',
        path: '/auth/login',
        statusCode: 401,
        ip: '127.0.0.1',
        userAgent: 'seed',
        login: 'trader1@example.com',
        body: {
          login: 'trader1@example.com',
          password: '[REDACTED]',
          totp: '[REDACTED]',
        },
      }),
      manager.create(AuditLog, {
        source: AuditSource.Http,
        actorUserId: admin.user.id,
        targetUserId: trader1.user.id,
        action: 'PATCH /admin/users/:id',
        method: 'PATCH',
        path: `/admin/users/${trader1.user.id}`,
        params: { id: trader1.user.id },
        statusCode: 200,
        ip: '127.0.0.1',
        userAgent: 'seed',
        body: { status: 'active' },
      }),
    ]);
  });

  console.log('\nSeed complete. Password for every account:', SEED_PASSWORD);
  console.log('TOTP secret for every account:', SEED_TOTP_SECRET);
  console.log(
    'Each account below also has 10 single-use backup codes; use one as `backupCode` in POST /auth/login instead of `totp`.\n',
  );

  for (const entry of credentials) {
    const login = loginOf(entry.user.user);
    console.log(`${entry.label}: ${login}`);
    if (entry.user.codes.length > 0) {
      console.log(`  backup codes: ${entry.user.codes.join(', ')}`);
    }
  }

  await dataSource.destroy();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import { In, IsNull, Not } from 'typeorm';
import { toFiat } from '../../common/utils/to-fiat';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { BankDetailsService } from '../bank-details.service';
import { BankDetails } from '../entities/bank-details.entity';
import { BankDetailsType } from '../types/bank-details-type.enum';

const build = () => {
  const repository = {
    find: jest.fn<Promise<BankDetails[]>, [unknown?]>(async () => []),
  };
  const devices = {
    onlineDeviceIds: jest.fn(async (): Promise<number[]> => []),
  };
  const config = { get: jest.fn(() => '5000') };
  const service = new BankDetailsService(
    repository as never,
    {} as never,
    devices as never,
    {} as never,
    config as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, repository, devices };
};

describe('BankDetailsService.findIdsOfBank', () => {
  it('lists the ids of every requisite at the bank, deleted ones included, in one query', async () => {
    const { service, repository } = build();
    repository.find.mockResolvedValue([
      { id: uuidOf(40) },
      { id: uuidOf(41) },
    ] as BankDetails[]);

    await expect(service.findIdsOfBank(7)).resolves.toEqual([
      uuidOf(40),
      uuidOf(41),
    ]);
    expect(repository.find).toHaveBeenCalledWith({
      select: { id: true },
      where: { bankId: 7 },
      withDeleted: true,
    });
  });
});

describe('BankDetailsService.findByIdsWithDeleted', () => {
  it('reads the requisites with their bank in one query, deleted ones included', async () => {
    const { service, repository } = build();
    const rows = [{ id: uuidOf(40) }] as BankDetails[];
    repository.find.mockResolvedValue(rows);

    await expect(service.findByIdsWithDeleted([uuidOf(40)])).resolves.toBe(
      rows,
    );
    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith({
      where: { id: In([uuidOf(40)]) },
      relations: { bank: true, mobileOperator: true },
      withDeleted: true,
    });
  });

  it('answers an empty id list without querying', async () => {
    const { service, repository } = build();

    await expect(service.findByIdsWithDeleted([])).resolves.toEqual([]);
    expect(repository.find).not.toHaveBeenCalled();
  });
});

describe('BankDetailsService.findCandidates', () => {
  const row = (overrides: Partial<BankDetails> = {}) =>
    ({
      id: uuidOf(40),
      userId: uuidOf(1),
      type: BankDetailsType.CardOrSbp,
      bankId: 3,
      bank: { currency: { isocode: 'RUB' } },
      mobileOperatorId: null,
      card: '4276000011112222',
      phone: null,
      deviceId: 9,
      active: true,
      bannedAt: null,
      counterpartyOnly: false,
      reserve: false,
      sameBankOnly: true,
      maxCounterparties: null,
      minAmountEnabled: true,
      minAmount: toFiat(100),
      maxAmountEnabled: false,
      maxAmount: toFiat(900),
      dailyLimitEnabled: true,
      dailyLimit: 5,
      monthlyLimitEnabled: false,
      monthlyLimit: 50,
      dailyAmountLimitEnabled: true,
      dailyAmountLimit: toFiat(100000),
      monthlyAmountLimitEnabled: false,
      monthlyAmountLimit: null,
      hourlyAmountLimitEnabled: true,
      hourlyAmountLimit: toFiat(20000),
      maxActiveTransactionsEnabled: true,
      maxActiveTransactions: 2,
      delayBetweenRequestsEnabled: false,
      delayBetweenRequests: 60,
      ...overrides,
    }) as unknown as BankDetails;

  it('reads the requisites the method maps to in one query, deleted ones left out, with the device heartbeat', async () => {
    const { service, repository, devices } = build();
    repository.find.mockResolvedValue([row()]);
    devices.onlineDeviceIds.mockResolvedValue([9]);
    const now = new Date('2026-11-04T12:00:00Z');

    const [candidate] = await service.findCandidates(
      {
        type: BankDetailsType.CardOrSbp,
        counterpartyOnly: false,
        withCard: true,
      },
      now,
    );

    expect(repository.find).toHaveBeenCalledWith({
      where: {
        counterpartyOnly: false,
        type: BankDetailsType.CardOrSbp,
        card: Not(IsNull()),
      },
      relations: { bank: { currency: true } },
      order: { id: 'ASC' },
    });
    expect(devices.onlineDeviceIds).toHaveBeenCalledWith([9], now);
    expect(candidate).toMatchObject({
      id: uuidOf(40),
      bankCurrency: 'RUB',
      deviceOnline: true,
      banned: false,
      sameBankOnly: true,
      minAmount: toFiat(100),
      maxAmount: null,
      dailyLimit: 5,
      monthlyLimit: null,
      hourlyAmountLimit: toFiat(20000),
      maxActiveTransactions: 2,
      delayBetweenRequestsSeconds: null,
    });
  });

  it('gives a counterparty-only requisite the configured floor, never its stored minimum', async () => {
    const { service, repository } = build();
    repository.find.mockResolvedValue([
      row({ counterpartyOnly: true, minAmountEnabled: true, minAmount: null }),
    ]);

    const [candidate] = await service.findCandidates({
      counterpartyOnly: true,
    });

    expect(candidate.minAmount).toEqual(toFiat(5000));
    expect(candidate.deviceOnline).toBe(false);
    expect(repository.find.mock.calls[0][0]).toMatchObject({
      where: { counterpartyOnly: true },
    });
  });
});

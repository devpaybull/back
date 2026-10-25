import { In } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { BankDetailsService } from '../bank-details.service';
import { BankDetails } from '../entities/bank-details.entity';

const build = () => {
  const repository = { find: jest.fn(async (): Promise<BankDetails[]> => []) };
  const service = new BankDetailsService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, repository };
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
      relations: { bank: true },
      withDeleted: true,
    });
  });

  it('answers an empty id list without querying', async () => {
    const { service, repository } = build();

    await expect(service.findByIdsWithDeleted([])).resolves.toEqual([]);
    expect(repository.find).not.toHaveBeenCalled();
  });
});

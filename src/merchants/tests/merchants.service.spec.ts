import { In } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { MerchantsService } from '../merchants.service';
import { MerchantSortField } from '../types/merchant-sort-field.enum';

describe('MerchantsService', () => {
  let merchants: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
  };
  let keys: { create: jest.Mock; save: jest.Mock };
  let service: MerchantsService;

  beforeEach(() => {
    merchants = {
      find: jest.fn(async () => []),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'm1', ...data })),
      findAndCount: jest.fn(async () => [[], 0]),
    };
    keys = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 1, ...data })),
    };
    service = new MerchantsService(merchants as never, keys as never);
  });

  it('creates a merchant by name', async () => {
    const result = await service.create('Acme');

    expect(merchants.create).toHaveBeenCalledWith({ name: 'Acme' });
    expect(result.id).toBe('m1');
  });

  it('creates through the given transaction when one is passed', async () => {
    const inTransaction = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'm2', ...data })),
    };
    const manager = { getRepository: jest.fn(() => inTransaction) };

    const result = await service.create('Acme', manager as never);

    expect(inTransaction.save).toHaveBeenCalledWith({ name: 'Acme' });
    expect(merchants.save).not.toHaveBeenCalled();
    expect(result.id).toBe('m2');
  });

  it('issues a key with a uuid key and a long hex secret', async () => {
    await service.createKey('m1');

    const created = keys.create.mock.calls[0][0];
    expect(created.merchantId).toBe('m1');
    expect(created.key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('orders by name with an id tiebreak when asked', async () => {
    await service.list({
      page: 1,
      limit: 20,
      sortBy: MerchantSortField.Name,
      sortOrder: SortOrder.Asc,
    });

    expect(merchants.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ order: { name: 'ASC', id: 'ASC' } }),
    );
  });

  it('reads every merchant of the given ids in one query', async () => {
    await service.findByIds(['m1', 'm2']);

    expect(merchants.find).toHaveBeenCalledTimes(1);
    expect(merchants.find).toHaveBeenCalledWith({
      where: { id: In(['m1', 'm2']) },
    });
  });

  it('asks nothing for an empty list of ids', async () => {
    await expect(service.findByIds([])).resolves.toEqual([]);
    expect(merchants.find).not.toHaveBeenCalled();
  });
});

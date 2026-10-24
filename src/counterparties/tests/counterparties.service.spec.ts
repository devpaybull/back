import { Repository } from 'typeorm';
import { CounterpartiesService } from '../counterparties.service';
import { Counterparty } from '../entities/counterparty.entity';

describe('CounterpartiesService', () => {
  let repository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: CounterpartiesService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ id: 1, ...row })),
    };
    service = new CounterpartiesService(
      repository as unknown as Repository<Counterparty>,
    );
  });

  describe('findOrCreate', () => {
    it('returns the existing record for the same merchant and external id', async () => {
      const existing = { id: 7 } as Counterparty;
      repository.findOne.mockResolvedValue(existing);

      const result = await service.findOrCreate('merchant-1', 'ext-42');

      expect(result).toBe(existing);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('creates a record with our own id when none exists', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.findOrCreate('merchant-1', 'ext-42', {
        name: 'Ivan',
        contact: 'ivan@example.com',
      });

      expect(repository.create).toHaveBeenCalledWith({
        merchantId: 'merchant-1',
        externalId: 'ext-42',
        name: 'Ivan',
        contact: 'ivan@example.com',
        payload: null,
      });
      expect(result.id).toBe(1);
    });

    it('scopes the lookup to the merchant and external id pair', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.findOrCreate('merchant-9', 'ext-42');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { merchantId: 'merchant-9', externalId: 'ext-42' },
      });
    });

    it('defaults optional fields to null', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.findOrCreate('merchant-1', 'ext-1');

      expect(repository.create).toHaveBeenCalledWith({
        merchantId: 'merchant-1',
        externalId: 'ext-1',
        name: null,
        contact: null,
        payload: null,
      });
    });
  });
});

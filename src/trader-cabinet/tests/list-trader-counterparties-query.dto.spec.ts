import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTraderCounterpartiesQueryDto } from '../dto/list-trader-counterparties-query.dto';

const errorsOf = async <T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> =>
  (await validate(plainToInstance(type, plain), { whitelist: true })).map(
    (error) => error.property,
  );

describe('ListTraderCounterpartiesQueryDto', () => {
  it('reads hideInactive from the query string and refuses an unknown sort', async () => {
    const dto = plainToInstance(ListTraderCounterpartiesQueryDto, {
      hideInactive: 'true',
    });
    expect(dto.hideInactive).toBe(true);
    expect(dto.sortBy).toBe('lastDealAt');
    expect(
      await errorsOf(ListTraderCounterpartiesQueryDto, {
        hideInactive: 'yes',
        sortBy: 'externalId',
      }),
    ).toEqual(['hideInactive', 'sortBy']);
  });
});

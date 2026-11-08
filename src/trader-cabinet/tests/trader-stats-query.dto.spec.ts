import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TraderStatsQueryDto } from '../dto/trader-stats-query.dto';

const errorsOf = async <T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> =>
  (await validate(plainToInstance(type, plain), { whitelist: true })).map(
    (error) => error.property,
  );

describe('TraderStatsQueryDto', () => {
  it('takes a stats period of days, a direction and a registry method', async () => {
    expect(
      await errorsOf(TraderStatsQueryDto, {
        periodFrom: '2026-11-01',
        periodTo: '2026-11-08',
        direction: 'pay_in',
        method: 'sbp',
      }),
    ).toEqual([]);
    expect(
      await errorsOf(TraderStatsQueryDto, {
        periodFrom: '2026-11-08',
        periodTo: '2026-11-01',
        direction: 'sideways',
        method: 'cash',
        bankDetailsId: 'nope',
      }),
    ).toEqual(['periodTo', 'direction', 'method', 'bankDetailsId']);
  });
});

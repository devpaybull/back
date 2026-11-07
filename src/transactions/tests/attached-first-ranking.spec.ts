import { AttachedFirstRanking } from '../services/attached-first-ranking.service';

const candidate = (
  bankDetailsId: string,
  attached: boolean,
  lastDealAt: string | null,
) => ({
  bankDetailsId,
  attached,
  lastDealAt: lastDealAt ? new Date(lastDealAt) : null,
});

describe('AttachedFirstRanking', () => {
  const ranking = new AttachedFirstRanking();

  it('puts attached requisites first, then the one idle the longest, never-used before any', () => {
    const ranked = ranking.rank([
      candidate('a', false, '2026-11-04T10:00:00Z'),
      candidate('b', true, '2026-11-04T11:00:00Z'),
      candidate('c', false, null),
      candidate('d', true, '2026-11-04T09:00:00Z'),
      candidate('e', false, '2026-11-04T08:00:00Z'),
    ]);

    expect(ranked.map((row) => row.bankDetailsId)).toEqual([
      'd',
      'b',
      'c',
      'e',
      'a',
    ]);
  });

  it('breaks a tie on the requisite id, so the order is stable', () => {
    expect(
      ranking
        .rank([candidate('z', false, null), candidate('y', false, null)])
        .map((row) => row.bankDetailsId),
    ).toEqual(['y', 'z']);
  });

  it('leaves the input untouched', () => {
    const input = [candidate('b', false, null), candidate('a', false, null)];

    ranking.rank(input);

    expect(input.map((row) => row.bankDetailsId)).toEqual(['b', 'a']);
  });
});

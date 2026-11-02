import { Brackets } from 'typeorm';
import { toFiat } from '../../common/utils/to-fiat';
import { CounterpartyStatus } from '../types/counterparty-status.enum';
import { applyCounterpartyFilter } from '../utils/apply-counterparty-filter';

describe('applyCounterpartyFilter', () => {
  let query: { setParameters: jest.Mock; andWhere: jest.Mock };

  const run = (filter: Parameters<typeof applyCounterpartyFilter>[1]) =>
    applyCounterpartyFilter(query as never, filter, '2026-11-02');

  const wheres = (): unknown[][] => query.andWhere.mock.calls;

  const innerCalls = (
    filter: Parameters<typeof applyCounterpartyFilter>[1],
  ) => {
    run(filter);
    const brackets = query.andWhere.mock.calls[0][0] as Brackets;
    const inner = {
      where: jest.fn(() => inner),
      orWhere: jest.fn(() => inner),
    };
    brackets.whereFactory(inner as never);
    return inner;
  };

  beforeEach(() => {
    query = {
      setParameters: jest.fn(),
      andWhere: jest.fn(),
    };
    query.setParameters.mockReturnValue(query);
    query.andWhere.mockReturnValue(query);
  });

  it('returns the builder it was given', () => {
    expect(run({})).toBe(query);
  });

  it('always sets the window start days of today', () => {
    run({});

    expect(query.setParameters).toHaveBeenCalledWith({
      since7: '2026-10-27',
      since30: '2026-10-04',
      since60: '2026-09-04',
      since90: '2026-08-05',
    });
  });

  it('adds no condition for an empty filter', () => {
    run({});

    expect(wheres()).toEqual([]);
  });

  describe('search', () => {
    it('escapes percent and underscore in the term', () => {
      const inner = innerCalls({ search: '50%_a' });

      expect(inner.where).toHaveBeenCalledWith(
        'counterparty.externalId ILIKE :term',
        { term: '%50\\%\\_a%' },
      );
    });

    it('does not add merchant or requisite alternatives when the lists are empty', () => {
      const inner = innerCalls({
        search: 'x',
        searchMerchantIds: [],
        searchBankDetailsIds: [],
      });

      expect(inner.orWhere).not.toHaveBeenCalled();
    });

    it('adds merchant and requisite alternatives when the lists have ids', () => {
      const inner = innerCalls({
        search: 'x',
        searchMerchantIds: ['m1'],
        searchBankDetailsIds: ['b1'],
      });

      expect(inner.orWhere.mock.calls).toEqual([
        [
          'counterparty.merchantId IN (:...searchMerchantIds)',
          { searchMerchantIds: ['m1'] },
        ],
        [
          'counterparty.bankDetailsId IN (:...searchBankDetailsIds)',
          { searchBankDetailsIds: ['b1'] },
        ],
      ]);
    });

    it('ignores the alternatives when there is no search term', () => {
      run({ searchMerchantIds: ['m1'] });

      expect(wheres()).toEqual([]);
    });
  });

  it('filters by merchant', () => {
    run({ merchantId: 'm1' });

    expect(wheres()).toEqual([
      ['counterparty.merchantId = :merchantId', { merchantId: 'm1' }],
    ]);
  });

  it('filters by requisites', () => {
    run({ bankDetailsIds: ['b1', 'b2'] });

    expect(wheres()).toEqual([
      [
        'counterparty.bankDetailsId IN (:...bankDetailsIds)',
        { bankDetailsIds: ['b1', 'b2'] },
      ],
    ]);
  });

  it.each([
    [CounterpartyStatus.Enabled, true],
    [CounterpartyStatus.Disabled, false],
  ])('maps status %s to enabled=%s', (status, enabled) => {
    run({ status });

    expect(wheres()).toEqual([
      ['counterparty.enabled = :enabled', { enabled }],
    ]);
  });

  it.each([
    [true, 'counterparty.blacklistedAt IS NOT NULL'],
    [false, 'counterparty.blacklistedAt IS NULL'],
  ])('maps blacklisted=%s to a null check', (blacklisted, sql) => {
    run({ blacklisted });

    expect(wheres()).toEqual([[sql]]);
  });

  it('filters by the auto enable ban', () => {
    run({ autoEnableForbidden: false });

    expect(wheres()).toEqual([
      [
        'counterparty.autoEnableForbidden = :autoEnableForbidden',
        { autoEnableForbidden: false },
      ],
    ]);
  });

  it.each([
    [true, 'counterparty.bankDetailsId IS NOT NULL'],
    [false, 'counterparty.bankDetailsId IS NULL'],
  ])('maps hasRequisite=%s to a null check', (hasRequisite, sql) => {
    run({ hasRequisite });

    expect(wheres()).toEqual([[sql]]);
  });

  describe('ranges', () => {
    it('passes the total volume bounds as formatted fiat strings', () => {
      run({ totalVolume: { from: toFiat('10'), to: toFiat('20.5') } });

      expect(wheres()).toEqual([
        [
          'counterparty.paidAmount >= :volumeTotalFrom',
          { volumeTotalFrom: '10.00' },
        ],
        [
          'counterparty.paidAmount <= :volumeTotalTo',
          { volumeTotalTo: '20.50' },
        ],
      ]);
    });

    it('adds only the bound that is given', () => {
      run({ totalVolume: { to: toFiat('5') } });

      expect(wheres()).toEqual([
        [
          'counterparty.paidAmount <= :volumeTotalTo',
          { volumeTotalTo: '5.00' },
        ],
      ]);
    });

    it('filters a window volume over its own window parameter', () => {
      run({ windowVolumes: new Map([[7, { from: toFiat('1') }]]) });

      expect(wheres()).toHaveLength(1);
      expect(wheres()[0][0]).toContain(':since7');
      expect(wheres()[0][0]).toContain('>= :volume7dFrom');
      expect(wheres()[0][1]).toEqual({ volume7dFrom: '1.00' });
    });

    it('filters the thirty day paid count with plain numbers', () => {
      run({ paid30d: { from: 2, to: 9 } });

      expect(wheres()).toHaveLength(2);
      expect(wheres()[0][0]).toContain('>= :paid30dFrom');
      expect(wheres()[0][1]).toEqual({ paid30dFrom: 2 });
      expect(wheres()[1][0]).toContain('<= :paid30dTo');
      expect(wheres()[1][1]).toEqual({ paid30dTo: 9 });
    });

    it('accepts a zero lower bound of the paid count', () => {
      run({ paid30d: { from: 0 } });

      expect(wheres()).toHaveLength(1);
    });
  });
});

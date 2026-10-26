import { toQueryList } from '../utils/to-query-list';

describe('toQueryList', () => {
  it('wraps a single value into a list', () => {
    expect(toQueryList({ value: 'pending' })).toEqual(['pending']);
  });

  it('splits comma-separated values and trims them', () => {
    expect(toQueryList({ value: 'pending, failed' })).toEqual([
      'pending',
      'failed',
    ]);
  });

  it('flattens repeated parameters and drops empty items', () => {
    expect(toQueryList({ value: ['pending,', 'completed'] })).toEqual([
      'pending',
      'completed',
    ]);
  });

  it('leaves an absent value alone', () => {
    expect(toQueryList({ value: undefined })).toBeUndefined();
  });
});

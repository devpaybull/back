export const uuidOf = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('uuidOf', () => {
  it('builds a distinct value for every number', () => {
    expect(uuidOf(1)).not.toBe(uuidOf(2));
  });

  it('builds something a uuid column would accept', () => {
    expect(uuidOf(404)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is stable for the same number', () => {
    expect(uuidOf(7)).toBe(uuidOf(7));
  });
});

import { csvField } from '../utils/csv-field';

describe('csvField', () => {
  it('writes a plain value as it is and null as empty', () => {
    expect(csvField('abc')).toBe('abc');
    expect(csvField(41)).toBe('41');
    expect(csvField(null)).toBe('');
  });

  it('quotes a comma, a quote or a line break, doubling quotes', () => {
    expect(csvField('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it.each(['=SUM(A1)', '+1+1', '-cmd', '@me', '\tx'])(
    'neutralises a spreadsheet formula in %p with a leading apostrophe',
    (value) => {
      expect(csvField(value)).toBe(`'${value}`);
    },
  );

  it('leaves a signed amount alone', () => {
    expect(csvField('-12.500000')).toBe('-12.500000');
    expect(csvField('-3')).toBe('-3');
  });
});

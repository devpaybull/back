import { sha256Hex } from '../utils/sha256-hex';

describe('sha256Hex', () => {
  it('matches the known digest of abc', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('returns the same digest for repeated calls', () => {
    expect(sha256Hex('repeatable')).toBe(sha256Hex('repeatable'));
  });

  it('returns different digests for different inputs', () => {
    expect(sha256Hex('one')).not.toBe(sha256Hex('two'));
  });
});

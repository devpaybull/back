import { escapeLikePattern } from '../utils/escape-like-pattern';

describe('escapeLikePattern', () => {
  it('leaves an ordinary term alone', () => {
    expect(escapeLikePattern('user@example.com')).toBe('user@example.com');
  });

  it('escapes the wildcard that would otherwise match anything', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('escapes the wildcard that would otherwise match one character', () => {
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes the escape character itself', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('escapes every occurrence, not only the first', () => {
    expect(escapeLikePattern('%_%')).toBe('\\%\\_\\%');
  });
});

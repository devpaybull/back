import { createHmac } from 'node:crypto';
import { callbackSignature } from '../utils/callback-signature';

describe('callbackSignature', () => {
  it('signs the timestamp, a dot and the raw body with HMAC-SHA256, in hex', () => {
    expect(callbackSignature('secret', '1700000000', '{"a":1}')).toBe(
      createHmac('sha256', 'secret').update('1700000000.{"a":1}').digest('hex'),
    );
  });

  it('changes with the secret, the time and the body', () => {
    const base = callbackSignature('s', '1', 'b');

    expect(callbackSignature('x', '1', 'b')).not.toBe(base);
    expect(callbackSignature('s', '2', 'b')).not.toBe(base);
    expect(callbackSignature('s', '1', 'c')).not.toBe(base);
  });
});

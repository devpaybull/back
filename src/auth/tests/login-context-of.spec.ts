import { Request } from 'express';
import { loginContextOf } from '../utils/login-context-of';

const requestWith = (ip: string | undefined, agent: string | undefined) =>
  ({ ip, get: jest.fn(() => agent) }) as unknown as Request;

describe('loginContextOf', () => {
  it('reads the address and the agent from the request', () => {
    expect(
      loginContextOf(requestWith('203.0.113.7', 'agent/1.0'), 'fp-1'),
    ).toEqual({
      ip: '203.0.113.7',
      userAgent: 'agent/1.0',
      fingerprint: 'fp-1',
    });
  });

  it('turns everything missing into null', () => {
    expect(loginContextOf(requestWith(undefined, undefined))).toEqual({
      ip: null,
      userAgent: null,
      fingerprint: null,
    });
  });
});

import { Logger } from '@nestjs/common';
import { TronUnavailableFilter } from '../filters/tron-unavailable.filter';
import { TronUnavailableError } from '../types/tron-unavailable.error';

describe('TronUnavailableFilter', () => {
  it('answers 503 without leaking the internal message', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    new TronUnavailableFilter().catch(
      new TronUnavailableError('Vault decrypt answered 500'),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      message: expect.stringMatching(/unavailable/),
      error: 'Service Unavailable',
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('Vault decrypt');
    expect(warn).toHaveBeenCalledWith('Vault decrypt answered 500');
    warn.mockRestore();
  });
});

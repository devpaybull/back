import { VaultTransitClient } from '../services/vault-transit.client';
import { TronUnavailableError } from '../types/tron-unavailable.error';

const config = {
  getOrThrow: jest.fn(
    (key: string) =>
      ({ VAULT_ADDR: 'http://vault:8200', VAULT_TRANSIT_KEY: 'paybull tron' })[
        key
      ],
  ),
};

const respond = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const plaintext = (text: string) =>
  respond({ data: { plaintext: Buffer.from(text).toString('base64') } });

describe('VaultTransitClient', () => {
  let fetchMock: jest.SpyInstance;
  let auth: { login: jest.Mock };

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    auth = {
      login: jest.fn(async () => ({
        token: 'tok',
        expiresAt: Date.now() + 3_600_000,
      })),
    };
  });

  afterEach(() => fetchMock.mockRestore());

  it('decrypts through transit with the token and decodes the base64 plaintext', async () => {
    fetchMock.mockResolvedValue(plaintext('secret words'));
    const client = new VaultTransitClient(config as never, auth);

    const decrypted = await client.decrypt('vault:v1:abc');

    expect(decrypted.toString('utf8')).toBe('secret words');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://vault:8200/v1/transit/decrypt/paybull%20tron');
    expect(init.headers['X-Vault-Token']).toBe('tok');
    expect(JSON.parse(init.body as string)).toEqual({
      ciphertext: 'vault:v1:abc',
    });
  });

  it('keeps the token until it is close to expiry', async () => {
    fetchMock.mockImplementation(async () => plaintext('x'));
    const client = new VaultTransitClient(config as never, auth);

    await client.decrypt('vault:v1:a');
    await client.decrypt('vault:v1:b');

    expect(auth.login).toHaveBeenCalledTimes(1);
  });

  it('logs in again when the token is within a minute of expiry', async () => {
    auth.login.mockResolvedValue({
      token: 'tok',
      expiresAt: Date.now() + 30_000,
    });
    fetchMock.mockImplementation(async () => plaintext('x'));
    const client = new VaultTransitClient(config as never, auth);

    await client.decrypt('vault:v1:a');
    await client.decrypt('vault:v1:b');

    expect(auth.login).toHaveBeenCalledTimes(2);
  });

  it('drops the cached token on a 403 so the next call logs in again', async () => {
    fetchMock.mockResolvedValueOnce(respond({}, 403));
    fetchMock.mockResolvedValueOnce(plaintext('x'));
    const client = new VaultTransitClient(config as never, auth);

    await expect(client.decrypt('vault:v1:a')).rejects.toBeInstanceOf(
      TronUnavailableError,
    );
    await client.decrypt('vault:v1:a');

    expect(auth.login).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'an unreachable vault',
      () => fetchMock.mockRejectedValue(new Error('down')),
    ],
    ['an error status', () => fetchMock.mockResolvedValue(respond({}, 500))],
    ['no plaintext', () => fetchMock.mockResolvedValue(respond({ data: {} }))],
  ])('answers %s with a TronUnavailableError', async (_case, arrange) => {
    arrange();
    const client = new VaultTransitClient(config as never, auth);

    await expect(client.decrypt('vault:v1:a')).rejects.toBeInstanceOf(
      TronUnavailableError,
    );
  });
});

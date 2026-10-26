import { AppRoleVaultAuth } from '../services/approle-vault-auth';
import { TronUnavailableError } from '../types/tron-unavailable.error';

const config = {
  getOrThrow: jest.fn(
    (key: string) =>
      ({
        VAULT_ADDR: 'http://vault:8200/',
        VAULT_ROLE_ID: 'role',
        VAULT_SECRET_ID: 'secret',
      })[key],
  ),
};

const respond = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

describe('AppRoleVaultAuth', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('logs in with the role and secret id and reads the lease', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    fetchMock.mockResolvedValue(
      respond({ auth: { client_token: 'tok', lease_duration: 3600 } }),
    );

    await expect(
      new AppRoleVaultAuth(config as never).login(),
    ).resolves.toEqual({
      token: 'tok',
      expiresAt: 1_000_000 + 3_600_000,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://vault:8200/v1/auth/approle/login');
    expect(JSON.parse(init.body as string)).toEqual({
      role_id: 'role',
      secret_id: 'secret',
    });
    jest.restoreAllMocks();
  });

  it.each([
    [
      'an unreachable vault',
      () => fetchMock.mockRejectedValue(new Error('down')),
    ],
    ['a refused login', () => fetchMock.mockResolvedValue(respond({}, 400))],
    [
      'an answer without a token',
      () => fetchMock.mockResolvedValue(respond({ auth: {} })),
    ],
  ])('answers %s with a TronUnavailableError', async (_case, arrange) => {
    arrange();

    await expect(
      new AppRoleVaultAuth(config as never).login(),
    ).rejects.toBeInstanceOf(TronUnavailableError);
  });
});

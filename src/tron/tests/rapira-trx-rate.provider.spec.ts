import { RapiraTrxRateProvider } from '../services/rapira-trx-rate.provider';
import { TronUnavailableError } from '../types/tron-unavailable.error';

const config = (ttl = 60) => ({
  get: jest.fn(
    (key: string, fallback?: unknown) =>
      ({
        TRX_RATE_TTL_SECONDS: ttl,
        RAPIRA_RATE_URL: 'https://api.rapira.net/open/market/rates',
      })[key] ?? fallback,
  ),
  getOrThrow: jest.fn(() => 'TRX/USDT'),
});

const respond = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const rates = respond({
  data: [
    { symbol: 'USDT/RUB', close: 81.5 },
    { symbol: 'TRX/USDT', close: 0.3412 },
  ],
});

describe('RapiraTrxRateProvider', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('reads the configured pair as an exact rate', async () => {
    fetchMock.mockResolvedValue(rates);

    const rate = await new RapiraTrxRateProvider(
      config() as never,
    ).getUsdtPerTrx();

    expect(rate.toFixed(6)).toBe('0.341200');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.rapira.net/open/market/rates',
    );
  });

  it('serves the cached rate within the TTL', async () => {
    fetchMock.mockResolvedValue(rates);
    const provider = new RapiraTrxRateProvider(config() as never);

    await provider.getUsdtPerTrx();
    await provider.getUsdtPerTrx();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last rate when the source fails', async () => {
    fetchMock.mockResolvedValueOnce(rates);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const provider = new RapiraTrxRateProvider(config(0) as never);

    await provider.getUsdtPerTrx();
    const fallback = await provider.getUsdtPerTrx();

    expect(fallback.toFixed(6)).toBe('0.341200');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'an unreachable source',
      () => fetchMock.mockRejectedValue(new Error('down')),
    ],
    ['an error status', () => fetchMock.mockResolvedValue(respond({}, 502))],
    [
      'a missing pair',
      () =>
        fetchMock.mockResolvedValue(
          respond({ data: [{ symbol: 'USDT/RUB', close: 1 }] }),
        ),
    ],
    [
      'a zero rate',
      () =>
        fetchMock.mockResolvedValue(
          respond({ data: [{ symbol: 'TRX/USDT', close: 0 }] }),
        ),
    ],
  ])(
    'answers %s with a TronUnavailableError when nothing is cached',
    async (_case, arrange) => {
      arrange();

      await expect(
        new RapiraTrxRateProvider(config() as never).getUsdtPerTrx(),
      ).rejects.toBeInstanceOf(TronUnavailableError);
    },
  );
});

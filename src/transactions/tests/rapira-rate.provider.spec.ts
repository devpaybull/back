import { ConfigService } from '@nestjs/config';
import { RapiraRateProvider } from '../services/rapira-rate.provider';

describe('RapiraRateProvider', () => {
  const settings: Record<string, unknown> = {
    RAPIRA_RATE_URL: 'https://api.rapira.net/open/market/rates',
    RAPIRA_RATE_SYMBOL: 'USDT/RUB',
    RAPIRA_RATE_TTL_SECONDS: 60,
  };

  const config = {
    get: (key: string) => settings[key],
  } as unknown as ConfigService;

  let fetchMock: jest.Mock;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ symbol: 'USDT/RUB', close: 88.04 }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the close price of the configured pair', async () => {
    const provider = new RapiraRateProvider(config);
    await expect(provider.getFiatPerUsdt()).resolves.toBe(88.04);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the cached rate within the TTL instead of refetching', async () => {
    const provider = new RapiraRateProvider(config);

    await provider.getFiatPerUsdt();
    now += 30_000;
    const second = await provider.getFiatPerUsdt();

    expect(second).toBe(88.04);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has elapsed', async () => {
    const provider = new RapiraRateProvider(config);

    await provider.getFiatPerUsdt();
    now += 61_000;
    await provider.getFiatPerUsdt();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches on every call when the TTL is zero', async () => {
    settings.RAPIRA_RATE_TTL_SECONDS = 0;
    const provider = new RapiraRateProvider(config);

    await provider.getFiatPerUsdt();
    await provider.getFiatPerUsdt();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    settings.RAPIRA_RATE_TTL_SECONDS = 60;
  });

  it('serves the last known rate when a refetch fails', async () => {
    const provider = new RapiraRateProvider(config);

    await provider.getFiatPerUsdt();
    now += 61_000;
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(provider.getFiatPerUsdt()).resolves.toBe(88.04);
  });

  it('throws only when the source is unreachable and no rate is known yet', async () => {
    settings.RAPIRA_RATE_TTL_SECONDS = 0;
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const provider = new RapiraRateProvider(config);

    await expect(provider.getFiatPerUsdt()).rejects.toThrow();
    settings.RAPIRA_RATE_TTL_SECONDS = 60;
  });
});

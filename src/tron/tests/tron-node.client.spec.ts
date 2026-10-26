import { TronWeb } from 'tronweb';
import { TronNodeClient } from '../services/tron-node.client';
import { TronUnavailableError } from '../types/tron-unavailable.error';

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TO = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
const FROM = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';

const config = (overrides: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    TRON_API_URL: 'https://nile.trongrid.io/',
    TRON_API_KEY: 'api-key',
    TRON_USDT_CONTRACT: USDT,
    TRON_CHAIN_PARAMS_TTL_SECONDS: 600,
    ...overrides,
  };

  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => values[key]),
  };
};

const respond = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

describe('TronNodeClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  const body = (call = 0) =>
    JSON.parse(fetchMock.mock.calls[call][1].body as string) as Record<
      string,
      unknown
    >;

  it('posts JSON with the API key to the path under the configured URL', async () => {
    fetchMock.mockResolvedValue(
      respond({ block_header: { raw_data: { number: 77 } } }),
    );
    const client = new TronNodeClient(config() as never);

    await expect(client.getSolidifiedBlockNumber()).resolves.toBe(77);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://nile.trongrid.io/walletsolidity/getnowblock');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'TRON-PRO-API-KEY': 'api-key',
    });
  });

  it('turns an unreachable node into a TronUnavailableError', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new TronNodeClient(config() as never);

    await expect(client.getSolidifiedBlockNumber()).rejects.toBeInstanceOf(
      TronUnavailableError,
    );
  });

  it('turns a non-2xx answer into a TronUnavailableError', async () => {
    fetchMock.mockResolvedValue(respond({}, 503));
    const client = new TronNodeClient(config() as never);

    await expect(client.getTrxBalanceSun(FROM)).rejects.toBeInstanceOf(
      TronUnavailableError,
    );
  });

  it('refuses an answer without a solidified block number', async () => {
    fetchMock.mockResolvedValue(respond({}));
    const client = new TronNodeClient(config() as never);

    await expect(client.getSolidifiedBlockNumber()).rejects.toBeInstanceOf(
      TronUnavailableError,
    );
  });

  it('reads the three chain prices and caches them for the TTL', async () => {
    fetchMock.mockResolvedValue(
      respond({
        chainParameter: [
          { key: 'getEnergyFee', value: 420 },
          { key: 'getTransactionFee', value: 1000 },
          { key: 'getCreateNewAccountFeeInSystemContract', value: 1_000_000 },
          { key: 'getOther' },
        ],
      }),
    );
    const client = new TronNodeClient(config() as never);

    const first = await client.getChainParameters();
    const second = await client.getChainParameters();

    expect(first).toEqual({
      energyFeeSun: 420,
      bandwidthFeeSun: 1000,
      createAccountFeeSun: 1_000_000,
    });
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the chain prices again once the TTL is over', async () => {
    fetchMock.mockResolvedValue(
      respond({
        chainParameter: [
          { key: 'getEnergyFee', value: 420 },
          { key: 'getTransactionFee', value: 1000 },
          { key: 'getCreateNewAccountFeeInSystemContract', value: 1 },
        ],
      }),
    );
    const client = new TronNodeClient(
      config({ TRON_CHAIN_PARAMS_TTL_SECONDS: 0 }) as never,
    );

    await client.getChainParameters();
    await client.getChainParameters();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses chain parameters missing a price instead of inventing one', async () => {
    fetchMock.mockResolvedValue(
      respond({ chainParameter: [{ key: 'getEnergyFee', value: 420 }] }),
    );
    const client = new TronNodeClient(config() as never);

    await expect(client.getChainParameters()).rejects.toBeInstanceOf(
      TronUnavailableError,
    );
  });

  it('answers null for a transaction the solidity node does not know', async () => {
    fetchMock.mockResolvedValue(respond({}));
    const client = new TronNodeClient(config() as never);

    await expect(
      client.getSolidifiedTransactionInfo('ab'.repeat(32)),
    ).resolves.toBeNull();
    expect(body()).toEqual({ value: 'ab'.repeat(32) });
  });

  it('answers an empty list for a block without transactions', async () => {
    fetchMock.mockResolvedValue(respond({}));
    const client = new TronNodeClient(config() as never);

    await expect(client.getSolidifiedTransactionInfos(5)).resolves.toEqual([]);
  });

  it('refuses an error object in place of the infos of a block', async () => {
    fetchMock.mockResolvedValue(respond({ Error: 'rate limited' }));
    const client = new TronNodeClient(config() as never);

    await expect(
      client.getSolidifiedTransactionInfos(5),
    ).rejects.toBeInstanceOf(TronUnavailableError);
  });

  it('counts the transactions of a solidified block it actually has', async () => {
    fetchMock.mockResolvedValue(
      respond({
        block_header: { raw_data: { number: 5 } },
        transactions: [{}, {}, {}],
      }),
    );
    const client = new TronNodeClient(config() as never);

    await expect(client.getSolidifiedBlockTransactionCount(5)).resolves.toBe(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://nile.trongrid.io/walletsolidity/getblockbynum',
    );
    expect(body()).toEqual({ num: 5 });
  });

  it.each([
    ['another block', { block_header: { raw_data: { number: 4 } } }],
    ['no block', {}],
  ])('refuses %s in place of the requested one', async (_case, answer) => {
    fetchMock.mockResolvedValue(respond(answer));
    const client = new TronNodeClient(config() as never);

    await expect(
      client.getSolidifiedBlockTransactionCount(5),
    ).rejects.toBeInstanceOf(TronUnavailableError);
  });

  it('counts zero for a block without transactions', async () => {
    fetchMock.mockResolvedValue(
      respond({ block_header: { raw_data: { number: 5 } } }),
    );
    const client = new TronNodeClient(config() as never);

    await expect(client.getSolidifiedBlockTransactionCount(5)).resolves.toBe(0);
  });

  it('accepts a duplicate broadcast and refuses any other refusal', async () => {
    const client = new TronNodeClient(config() as never);
    fetchMock.mockResolvedValueOnce(respond({ result: true }));
    fetchMock.mockResolvedValueOnce(respond({ code: 'DUP_TRANSACTION_ERROR' }));
    fetchMock.mockResolvedValueOnce(respond({ code: 'SIGERROR' }));

    await expect(client.broadcast({} as never)).resolves.toBeUndefined();
    await expect(client.broadcast({} as never)).resolves.toBeUndefined();
    await expect(client.broadcast({} as never)).rejects.toBeInstanceOf(
      TronUnavailableError,
    );
  });

  it('encodes a transfer as the padded recipient followed by the padded amount', async () => {
    fetchMock.mockResolvedValue(respond({ transaction: { txID: 'x' } }));
    const client = new TronNodeClient(config() as never);

    await client.buildUsdtTransfer(FROM, TO, '12500000', '30000000');

    const request = body();
    const recipient = TronWeb.address.toHex(TO).slice(2).padStart(64, '0');
    expect(request).toEqual(
      expect.objectContaining({
        owner_address: FROM,
        contract_address: USDT,
        function_selector: 'transfer(address,uint256)',
        parameter: recipient + (12_500_000).toString(16).padStart(64, '0'),
        fee_limit: 30_000_000,
        call_value: 0,
        visible: true,
      }),
    );
    expect((request.parameter as string).length).toBe(128);
  });

  it('refuses a build the node answers without a transaction', async () => {
    fetchMock.mockResolvedValue(
      respond({ result: { message: 'balance is not sufficient' } }),
    );
    const client = new TronNodeClient(config() as never);

    await expect(client.buildUsdtTransfer(FROM, TO, '1', '1')).rejects.toThrow(
      /balance is not sufficient/,
    );
  });

  it('reads a USDT balance from the constant call result', async () => {
    fetchMock.mockResolvedValue(
      respond({
        constant_result: [25_000_000n.toString(16).padStart(64, '0')],
      }),
    );
    const client = new TronNodeClient(config() as never);

    await expect(client.getUsdtBalanceSun(TO)).resolves.toBe('25000000');
    expect(body().function_selector).toBe('balanceOf(address)');
  });

  it('reads the energy estimate and refuses an answer without one', async () => {
    const client = new TronNodeClient(config() as never);
    fetchMock.mockResolvedValueOnce(respond({ energy_used: 64_285 }));
    fetchMock.mockResolvedValueOnce(respond({}));

    await expect(
      client.estimateUsdtTransferEnergy(FROM, TO, '1'),
    ).resolves.toBe(64_285);
    await expect(
      client.estimateUsdtTransferEnergy(FROM, TO, '1'),
    ).rejects.toBeInstanceOf(TronUnavailableError);
  });

  it('builds a delegation of energy, never locked', async () => {
    fetchMock.mockResolvedValue(respond({ txID: 'tx' }));
    const client = new TronNodeClient(config() as never);

    await client.buildEnergyDelegation(FROM, TO, '2000000');

    expect(body()).toEqual({
      owner_address: FROM,
      receiver_address: TO,
      balance: 2_000_000,
      resource: 'ENERGY',
      lock: false,
      visible: true,
    });
  });

  it('refuses a system-contract build answered with an error', async () => {
    fetchMock.mockResolvedValue(respond({ Error: 'account does not exist' }));
    const client = new TronNodeClient(config() as never);

    await expect(client.buildTrxTransfer(FROM, TO, '1')).rejects.toThrow(
      /account does not exist/,
    );
  });

  it('maps account resources with zeros for absent fields', async () => {
    fetchMock.mockResolvedValue(
      respond({ EnergyLimit: 100, freeNetLimit: 600 }),
    );
    const client = new TronNodeClient(config() as never);

    await expect(client.getAccountResources(TO)).resolves.toEqual({
      energyLimit: 100,
      energyUsed: 0,
      freeBandwidthLimit: 600,
      freeBandwidthUsed: 0,
      bandwidthLimit: 0,
      bandwidthUsed: 0,
      totalEnergyLimit: 0,
      totalEnergyWeight: 0,
    });
  });

  it('tells an activated account from an unknown one', async () => {
    const client = new TronNodeClient(config() as never);
    fetchMock.mockResolvedValueOnce(respond({ address: TO }));
    fetchMock.mockResolvedValueOnce(respond({}));

    await expect(client.isActivated(TO)).resolves.toBe(true);
    await expect(client.isActivated(TO)).resolves.toBe(false);
  });
});

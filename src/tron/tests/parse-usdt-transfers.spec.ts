import { TronWeb } from 'tronweb';
import { TronTransactionInfo } from '../types/tron-transaction-info';
import { parseUsdtTransfers } from '../utils/parse-usdt-transfers';
import { USDT_TRANSFER_TOPIC } from '../utils/usdt-transfer-topic';

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const FROM = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const TO = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';

const topicOf = (address: string): string =>
  TronWeb.address.toHex(address).slice(2).padStart(64, '0');
const contractHex = TronWeb.address.toHex(USDT).slice(2);

const transferLog = (
  overrides: Partial<{ address: string; topic: string; amount: bigint }> = {},
) => ({
  address: overrides.address ?? contractHex,
  topics: [overrides.topic ?? USDT_TRANSFER_TOPIC, topicOf(FROM), topicOf(TO)],
  data: (overrides.amount ?? 12_500_000n).toString(16).padStart(64, '0'),
});

const info = (log: TronTransactionInfo['log']): TronTransactionInfo => ({
  id: 'ab'.repeat(32),
  blockNumber: 100,
  blockTimeStamp: 1_700_000_000_000,
  log,
});

describe('parseUsdtTransfers', () => {
  it('decodes sender, recipient, amount and the position of the log', () => {
    const [transfer] = parseUsdtTransfers(info([transferLog()]), USDT);

    expect(transfer).toEqual({
      txHash: 'ab'.repeat(32),
      logIndex: 0,
      from: FROM,
      to: TO,
      amount: expect.anything(),
      blockNumber: 100,
      blockTime: new Date(1_700_000_000_000),
    });
    expect(transfer.amount.toFixed(6)).toBe('12.500000');
  });

  it('ignores another contract and another event, keeping the index of each log', () => {
    const otherContract = TronWeb.address
      .toHex('TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC')
      .slice(2);
    const transfers = parseUsdtTransfers(
      info([
        transferLog({ address: otherContract }),
        transferLog({ topic: '00'.repeat(32) }),
        transferLog({ amount: 1n }),
      ]),
      USDT,
    );

    expect(transfers).toHaveLength(1);
    expect(transfers[0].logIndex).toBe(2);
    expect(transfers[0].amount.toFixed(6)).toBe('0.000001');
  });

  it('accepts the log address with or without the 41 prefix', () => {
    expect(
      parseUsdtTransfers(
        info([transferLog({ address: `41${contractHex}` })]),
        USDT,
      ),
    ).toHaveLength(1);
  });

  it('does not cut a contract whose bare hex itself starts with 41', () => {
    const bare = `41${'ab'.repeat(19)}`;
    const contract = TronWeb.address.fromHex(`41${bare}`);

    expect(
      parseUsdtTransfers(info([transferLog({ address: bare })]), contract),
    ).toHaveLength(1);
    expect(
      parseUsdtTransfers(
        info([transferLog({ address: `41${bare}` })]),
        contract,
      ),
    ).toHaveLength(1);
    expect(
      parseUsdtTransfers(
        info([transferLog({ address: bare.slice(2) })]),
        contract,
      ),
    ).toHaveLength(0);
  });

  it('answers nothing for a transaction without logs', () => {
    expect(parseUsdtTransfers(info(undefined), USDT)).toEqual([]);
  });
});

import { utils } from 'tronweb';
import { TronTransaction } from '../types/tron-transaction';

export const serializedTransaction = (
  type: string,
  value: Record<string, unknown>,
  extras: { feeLimit?: number; expiration?: number } = {},
): TronTransaction => {
  const transaction = {
    visible: true,
    txID: '',
    raw_data_hex: '',
    raw_data: {
      contract: [
        {
          type,
          parameter: {
            value,
            type_url: `type.googleapis.com/protocol.${type}`,
          },
        },
      ],
      ref_block_bytes: '1a2b',
      ref_block_hash: '0011223344556677',
      expiration: extras.expiration ?? Date.now() + 60_000,
      timestamp: Date.now(),
      ...(extras.feeLimit === undefined ? {} : { fee_limit: extras.feeLimit }),
    },
  };
  const protobuf = utils.transaction.txJsonToPb(transaction as never);
  transaction.raw_data_hex = utils.transaction.txPbToRawDataHex(protobuf);
  transaction.txID = utils.transaction.txPbToTxID(protobuf).replace(/^0x/, '');

  return transaction as TronTransaction;
};

describe('serializedTransaction', () => {
  it('builds a transaction whose raw data, hex and id agree', () => {
    const transaction = serializedTransaction('TransferContract', {
      owner_address: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
      to_address: 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
      amount: 1,
    });

    expect(utils.transaction.txCheck(transaction as never)).toBe(true);
  });
});

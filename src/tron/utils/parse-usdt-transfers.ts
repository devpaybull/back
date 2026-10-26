import { TronWeb } from 'tronweb';
import { TronTransactionInfo } from '../types/tron-transaction-info';
import { UsdtTransferEvent } from '../types/usdt-transfer-event';
import { fromSun } from './from-sun';
import { USDT_TRANSFER_TOPIC } from './usdt-transfer-topic';

const topicToAddress = (topic: string): string =>
  TronWeb.address.fromHex(`41${topic.slice(-40)}`);

export const parseUsdtTransfers = (
  info: TronTransactionInfo,
  usdtContract: string,
): UsdtTransferEvent[] => {
  const contractHex = TronWeb.address
    .toHex(usdtContract)
    .slice(2)
    .toLowerCase();

  return (info.log ?? []).flatMap((log, logIndex) => {
    const [topic, from, to] = log.topics ?? [];

    const logAddress = (log.address ?? '').toLowerCase();
    const logContract =
      logAddress.length === 42 ? logAddress.slice(2) : logAddress;

    if (
      logContract !== contractHex ||
      topic?.toLowerCase() !== USDT_TRANSFER_TOPIC ||
      !from ||
      !to
    ) {
      return [];
    }

    return [
      {
        txHash: info.id,
        logIndex,
        from: topicToAddress(from),
        to: topicToAddress(to),
        amount: fromSun(BigInt(`0x${log.data || '0'}`)),
        blockNumber: info.blockNumber ?? 0,
        blockTime: new Date(info.blockTimeStamp ?? 0),
      },
    ];
  });
};

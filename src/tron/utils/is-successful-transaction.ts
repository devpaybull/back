import { TronTransactionInfo } from '../types/tron-transaction-info';

export const isSuccessfulTransaction = (info: TronTransactionInfo): boolean =>
  info.result !== 'FAILED' &&
  (info.receipt?.result === undefined || info.receipt.result === 'SUCCESS');

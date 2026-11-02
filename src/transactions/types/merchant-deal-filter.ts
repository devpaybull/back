import { TransactionListQuery } from './transaction-list-query';

export type MerchantDealFilter = Omit<
  TransactionListQuery,
  | 'page'
  | 'limit'
  | 'sortBy'
  | 'sortOrder'
  | 'merchantId'
  | 'traderUserId'
  | 'bankDetailsIds'
  | 'merchantRanks'
  | 'status'
>;

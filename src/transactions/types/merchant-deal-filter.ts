import { TransactionListQuery } from './transaction-list-query';

export type MerchantDealFilter = Omit<
  TransactionListQuery,
  | 'page'
  | 'limit'
  | 'sortBy'
  | 'sortOrder'
  | 'merchantId'
  | 'merchantIds'
  | 'counterpartyIds'
  | 'traderUserId'
  | 'bankDetailsIds'
  | 'merchantRanks'
  | 'status'
>;

import { TransactionListQuery } from './transaction-list-query';

export type TraderDealFilter = Pick<
  TransactionListQuery,
  | 'statuses'
  | 'method'
  | 'createdFrom'
  | 'createdTo'
  | 'amountFrom'
  | 'amountTo'
  | 'bankDetailsIds'
  | 'merchantIds'
  | 'counterpartyIds'
  | 'idSearch'
>;

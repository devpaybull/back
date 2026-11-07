import { TransactionListQuery } from './transaction-list-query';

export type TraderPayoutFilter = Pick<
  TransactionListQuery,
  | 'statuses'
  | 'method'
  | 'createdFrom'
  | 'createdTo'
  | 'amountFrom'
  | 'amountTo'
  | 'merchantIds'
  | 'idSearch'
>;

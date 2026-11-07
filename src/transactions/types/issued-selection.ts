import { Transaction } from '../entities/transaction.entity';
import { SelectionSummary } from './selection-summary';

export interface IssuedSelection {
  transaction: Transaction;
  viaBinding: boolean;
  boundNow: boolean;
  summary: SelectionSummary;
}

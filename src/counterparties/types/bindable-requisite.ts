import { TransactionType } from '../../common/enums/transaction-type.enum';

export interface BindableRequisite {
  id: string;
  type: TransactionType;
  counterpartyOnly: boolean;
  userId: string;
}

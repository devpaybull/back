import { BankDetailsType } from './bank-details-type.enum';

export interface RequisiteCandidateQuery {
  type?: BankDetailsType;
  counterpartyOnly: boolean;
  withCard?: boolean;
  withPhone?: boolean;
}

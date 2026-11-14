export interface TransactionTextMatch {
  search?: string;
  requisite?: { bankDetailsIds: string[]; text: string };
}

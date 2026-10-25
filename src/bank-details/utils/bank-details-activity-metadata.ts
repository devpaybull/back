import { BankDetails } from '../entities/bank-details.entity';

export const bankDetailsActivityMetadata = (
  details: BankDetails,
): Record<string, unknown> => ({
  id: details.id,
  type: details.type,
  card: details.card ?? null,
  phone: details.phone ?? null,
  cardholderName: details.cardholderName ?? null,
  bankId: details.bankId,
  bankName: details.bank?.name ?? null,
});

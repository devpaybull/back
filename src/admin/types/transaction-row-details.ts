import { DealBankDetailsDto } from '../dto/deal-bank-details.dto';
import { DealCounterpartyDto } from '../dto/deal-counterparty.dto';
import { DealTraderDto } from '../dto/deal-trader.dto';
import { UserMerchantDto } from '../dto/user-merchant.dto';

export interface TransactionRowDetails {
  trader: DealTraderDto | null;
  merchant: UserMerchantDto | null;
  bankDetails: DealBankDetailsDto | null;
  counterparty: DealCounterpartyDto | null;
}

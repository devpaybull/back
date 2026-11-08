import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { Fiat } from '../../common/types/fiat';

export interface DeviceConfirmationRequest {
  traderUserId: string;
  deviceId: number;
  messageId: number;
  bankId: number;
  amountFiat: Fiat;
  createdNoLaterThan: Date;
  requisites: readonly Pick<BankDetails, 'id' | 'bankId'>[];
}

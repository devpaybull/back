import { PaymentDto } from '../../transactions/dto/payment.dto';

export interface PayOutOutcome {
  payment: PaymentDto;
  created: boolean;
}

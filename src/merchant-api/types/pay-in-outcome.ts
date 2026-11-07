import { PaymentDto } from '../../transactions/dto/payment.dto';

export interface PayInOutcome {
  payment: PaymentDto;
  created: boolean;
  sameRequest: boolean;
}

import { Fiat } from '../../common/types/fiat';
import { BankMessageTemplate } from '../entities/bank-message-template.entity';

export interface RecognisedMessage {
  senderKnown: boolean;
  template: BankMessageTemplate | null;
  amount: Fiat | null;
}

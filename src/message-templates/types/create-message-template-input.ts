import { BankMessageType } from './bank-message-type.enum';

export interface CreateMessageTemplateInput {
  bankId: number;
  sender: string;
  messageType: BankMessageType;
  pattern: string;
  active?: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import { BankMessageTemplate } from '../../message-templates/entities/bank-message-template.entity';
import { BankMessageType } from '../../message-templates/types/bank-message-type.enum';

class MessageTemplateBankDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;
}

export class MessageTemplateDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  bankId: number;

  @ApiProperty({ type: MessageTemplateBankDto, nullable: true })
  bank: MessageTemplateBankDto | null;

  @ApiProperty({ example: '900' })
  sender: string;

  @ApiProperty({ enum: BankMessageType })
  messageType: BankMessageType;

  @ApiProperty({ example: 'Зачисление (?<amount>[\\d\\s]+(?:[.,]\\d{1,2})?)' })
  pattern: string;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  createdAt: Date;
}

export const toMessageTemplateDto = (
  template: BankMessageTemplate,
): MessageTemplateDto => ({
  id: template.id,
  bankId: template.bankId,
  bank: template.bank
    ? { id: template.bank.id, name: template.bank.name }
    : null,
  sender: template.sender,
  messageType: template.messageType,
  pattern: template.pattern,
  active: template.active,
  createdAt: template.createdAt,
});

import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankMessageType } from './bank-message-type.enum';
import { MessageTemplateSortField } from './message-template-sort-field.enum';

export interface MessageTemplateListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy: MessageTemplateSortField;
  sortOrder: SortOrder;
  bankId?: number;
  messageType?: BankMessageType;
  active?: boolean;
}

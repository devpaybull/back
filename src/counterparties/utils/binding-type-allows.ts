import { TransactionType } from '../../common/enums/transaction-type.enum';
import { CounterpartyBindingType } from '../types/counterparty-binding-type.enum';

const CHANNELS: Record<CounterpartyBindingType, readonly TransactionType[]> = {
  [CounterpartyBindingType.CardsOrSbp]: [
    TransactionType.Card,
    TransactionType.Sbp,
  ],
  [CounterpartyBindingType.Cards]: [TransactionType.Card],
  [CounterpartyBindingType.Sbp]: [TransactionType.Sbp],
};

export function bindingTypeAllows(
  bindingType: CounterpartyBindingType,
  channel: TransactionType,
): boolean {
  return CHANNELS[bindingType].includes(channel);
}

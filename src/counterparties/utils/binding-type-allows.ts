import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { BindableRequisite } from '../types/bindable-requisite';
import { CounterpartyBindingType } from '../types/counterparty-binding-type.enum';

export function bindingTypeAllows(
  bindingType: CounterpartyBindingType,
  requisite: Pick<BindableRequisite, 'type' | 'card' | 'phone'>,
): boolean {
  if (requisite.type !== BankDetailsType.CardOrSbp) return false;

  const servesCard = Boolean(requisite.card);
  const servesSbp = Boolean(requisite.phone);

  switch (bindingType) {
    case CounterpartyBindingType.CardsOrSbp:
      return servesCard || servesSbp;
    case CounterpartyBindingType.Cards:
      return servesCard;
    case CounterpartyBindingType.Sbp:
      return servesSbp;
  }
}

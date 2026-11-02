import { TransactionType } from '../../common/enums/transaction-type.enum';
import { CounterpartyBindingType } from '../types/counterparty-binding-type.enum';
import { bindingTypeAllows } from '../utils/binding-type-allows';

describe('bindingTypeAllows', () => {
  it.each([TransactionType.Card, TransactionType.Sbp])(
    'allows %s for cards_or_sbp',
    (channel) => {
      expect(
        bindingTypeAllows(CounterpartyBindingType.CardsOrSbp, channel),
      ).toBe(true);
    },
  );

  it('allows a card for cards', () => {
    expect(
      bindingTypeAllows(CounterpartyBindingType.Cards, TransactionType.Card),
    ).toBe(true);
  });

  it('refuses an sbp requisite for cards', () => {
    expect(
      bindingTypeAllows(CounterpartyBindingType.Cards, TransactionType.Sbp),
    ).toBe(false);
  });

  it('allows an sbp requisite for sbp', () => {
    expect(
      bindingTypeAllows(CounterpartyBindingType.Sbp, TransactionType.Sbp),
    ).toBe(true);
  });

  it('refuses a card requisite for sbp', () => {
    expect(
      bindingTypeAllows(CounterpartyBindingType.Sbp, TransactionType.Card),
    ).toBe(false);
  });
});

import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { CounterpartyBindingType } from '../types/counterparty-binding-type.enum';
import { bindingTypeAllows } from '../utils/binding-type-allows';

const CARD = '4400430212345678';
const PHONE = '79001234567';

const cardOrSbp = (card: string | null, phone: string | null) => ({
  type: BankDetailsType.CardOrSbp,
  card,
  phone,
});

describe('bindingTypeAllows', () => {
  it.each([
    ['a card', cardOrSbp(CARD, null)],
    ['a phone', cardOrSbp(null, PHONE)],
    ['both', cardOrSbp(CARD, PHONE)],
  ])('allows a card-or-sbp requisite with %s for cards_or_sbp', (_, req) => {
    expect(bindingTypeAllows(CounterpartyBindingType.CardsOrSbp, req)).toBe(
      true,
    );
  });

  it('allows a requisite with a card for cards', () => {
    expect(
      bindingTypeAllows(CounterpartyBindingType.Cards, cardOrSbp(CARD, null)),
    ).toBe(true);
  });

  it('refuses a requisite with only a phone for cards', () => {
    expect(
      bindingTypeAllows(CounterpartyBindingType.Cards, cardOrSbp(null, PHONE)),
    ).toBe(false);
  });

  it('allows a requisite with a phone for sbp', () => {
    expect(
      bindingTypeAllows(CounterpartyBindingType.Sbp, cardOrSbp(CARD, PHONE)),
    ).toBe(true);
  });

  it('refuses a requisite with only a card for sbp', () => {
    expect(
      bindingTypeAllows(CounterpartyBindingType.Sbp, cardOrSbp(CARD, null)),
    ).toBe(false);
  });

  it.each(Object.values(CounterpartyBindingType))(
    'refuses a mobile requisite for %s, whatever it carries',
    (bindingType) => {
      expect(
        bindingTypeAllows(bindingType, {
          type: BankDetailsType.Mobile,
          card: null,
          phone: PHONE,
        }),
      ).toBe(false);
    },
  );
});

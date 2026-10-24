import {
  DealComputation,
  DealComputationInput,
} from '../types/deal-computation';
import { TransactionKind } from '../types/transaction-kind.enum';
import { roundMoney } from './round-money';

export function computeDeal(input: DealComputationInput): DealComputation {
  const { amountFiat, rate, merchantPercent, traderPercent, leadPercent } =
    input;

  const merchantFraction = merchantPercent / 100;
  const traderFraction = traderPercent / 100;

  const amountCrypto = roundMoney(amountFiat / rate);
  const merchantCommission = roundMoney(amountCrypto * merchantFraction);
  const leadCommission =
    leadPercent === undefined || leadPercent === null
      ? null
      : roundMoney(amountCrypto * (leadPercent / 100));

  if (input.kind === TransactionKind.PayIn) {
    const traderAmount = roundMoney(amountFiat / (rate * (1 + traderFraction)));
    const traderCommission = roundMoney(Math.abs(amountCrypto - traderAmount));
    const merchantAmount = roundMoney(amountCrypto - merchantCommission);

    return {
      amountCrypto,
      merchantCommission,
      traderCommission,
      leadCommission,
      traderAmount,
      merchantAmount,
    };
  }

  const traderCommission = roundMoney(amountCrypto * traderFraction);
  const traderAmount = roundMoney(amountCrypto + traderCommission);
  const merchantAmount = roundMoney(amountCrypto + merchantCommission);

  return {
    amountCrypto,
    merchantCommission,
    traderCommission,
    leadCommission,
    traderAmount,
    merchantAmount,
  };
}

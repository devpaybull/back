import { roundCrypto } from '../../common/utils/round-crypto';
import {
  DealComputation,
  DealComputationInput,
} from '../types/deal-computation';

export function computePayOutRequest({
  amountFiat,
  rate,
  merchantPercent,
}: Pick<DealComputationInput, 'amountFiat' | 'rate' | 'merchantPercent'>): Pick<
  DealComputation,
  'amountCrypto' | 'merchantCommission' | 'merchantAmount'
> {
  const amountCrypto = roundCrypto(amountFiat.div(rate));
  const merchantCommission = roundCrypto(
    amountCrypto.times(merchantPercent).div(100),
  );

  return {
    amountCrypto,
    merchantCommission,
    merchantAmount: roundCrypto(amountCrypto.plus(merchantCommission)),
  };
}

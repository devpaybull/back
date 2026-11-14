import { Fiat } from '../../common/types/fiat';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { Transaction } from '../entities/transaction.entity';
import { ChangedDealFigures } from '../types/changed-deal-figures';
import { computeDeal } from './compute-deal';

const NO_PLATFORM_MINIMUM = 0;

export function recomputeChangedDeal(
  deal: Pick<
    Transaction,
    'kind' | 'rate' | 'merchantPercent' | 'traderEffectivePercent'
  >,
  shares: readonly Pick<TransactionLeadShare, 'id' | 'percent'>[],
  amountFiat: Fiat,
): ChangedDealFigures {
  const figures = computeDeal({
    kind: deal.kind,
    amountFiat,
    rate: deal.rate,
    merchantPercent: deal.merchantPercent,
    traderPercent: deal.traderEffectivePercent,
    platformMinPercent: NO_PLATFORM_MINIMUM,
  });
  const leadShares = shares.map((share) => ({
    shareId: share.id,
    amount: roundCrypto(figures.amountCrypto.times(share.percent).div(100)),
  }));

  return {
    amountCrypto: figures.amountCrypto,
    merchantCommission: figures.merchantCommission,
    traderCommission: figures.traderCommission,
    leadCommission: leadShares.length
      ? roundCrypto(
          leadShares.reduce((sum, lead) => sum.plus(lead.amount), toDecimal(0)),
        )
      : null,
    traderAmount: figures.traderAmount,
    merchantAmount: figures.merchantAmount,
    leadShares,
  };
}

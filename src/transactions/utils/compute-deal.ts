import Decimal from 'decimal.js';
import { Crypto } from '../../common/types/crypto';
import { PERCENT_SCALE } from '../../common/utils/percent-scale';
import { roundCrypto } from '../../common/utils/round-crypto';
import { roundHalfEven } from '../../common/utils/round-half-even';
import { toDecimal } from '../../common/utils/to-decimal';
import {
  DealComputation,
  DealComputationInput,
  DealLeadShare,
} from '../types/deal-computation';
import { TransactionKind } from '../types/transaction-kind.enum';

export class PlatformMinimumUnreachableError extends Error {
  constructor() {
    super(
      'The lead rates leave the platform below its minimum by more than the trader rate',
    );
    this.name = 'PlatformMinimumUnreachableError';
  }
}

const toPercentNumber = (value: Decimal): number =>
  roundHalfEven(value, PERCENT_SCALE).toNumber();

const share = (amount: Crypto, percent: Decimal.Value): Crypto =>
  roundCrypto(amount.times(percent).div(100));

export function computeDeal(input: DealComputationInput): DealComputation {
  const { amountFiat, rate, merchantPercent, traderPercent } = input;
  const leads = input.leads ?? [];

  const leadSum = leads.reduce(
    (sum, lead) => sum.plus(lead.percent),
    toDecimal(0),
  );
  const shortfall =
    leads.length === 0
      ? toDecimal(0)
      : toDecimal(
          Decimal.max(
            0,
            toDecimal(input.platformMinPercent).minus(
              toDecimal(merchantPercent).minus(traderPercent).minus(leadSum),
            ),
          ),
        );

  if (shortfall.gt(traderPercent)) {
    throw new PlatformMinimumUnreachableError();
  }

  const traderEffective = toDecimal(traderPercent).minus(shortfall);

  const amountCrypto = roundCrypto(amountFiat.div(rate));
  const merchantCommission = share(amountCrypto, merchantPercent);
  const leadShares: DealLeadShare[] = leads.map((lead) => ({
    leadUserId: lead.leadUserId,
    percent: lead.percent,
    amount: share(amountCrypto, lead.percent),
  }));
  const hasLeads = leadShares.length > 0;

  const shared = {
    amountCrypto,
    merchantCommission,
    traderEffectivePercent: toPercentNumber(traderEffective),
    shortfallPercent: toPercentNumber(shortfall),
    leadPercent: hasLeads ? toPercentNumber(leadSum) : null,
    leadCommission: hasLeads
      ? roundCrypto(
          leadShares.reduce((sum, lead) => sum.plus(lead.amount), toDecimal(0)),
        )
      : null,
    leadShares,
  };

  if (input.kind === TransactionKind.PayIn) {
    const traderAmount = roundCrypto(
      amountFiat.div(rate.times(traderEffective.div(100).plus(1))),
    );

    return {
      ...shared,
      traderCommission: roundCrypto(amountCrypto.minus(traderAmount).abs()),
      traderAmount,
      merchantAmount: roundCrypto(amountCrypto.minus(merchantCommission)),
    };
  }

  const traderCommission = share(amountCrypto, traderEffective);

  return {
    ...shared,
    traderCommission,
    traderAmount: roundCrypto(amountCrypto.plus(traderCommission)),
    merchantAmount: roundCrypto(amountCrypto.plus(merchantCommission)),
  };
}

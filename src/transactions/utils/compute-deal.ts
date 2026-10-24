import {
  DealComputation,
  DealComputationInput,
  DealLeadShare,
} from '../types/deal-computation';
import { TransactionKind } from '../types/transaction-kind.enum';
import { roundMoney } from './round-money';

export class PlatformMinimumUnreachableError extends Error {
  constructor() {
    super(
      'The lead rates leave the platform below its minimum by more than the trader rate',
    );
    this.name = 'PlatformMinimumUnreachableError';
  }
}

export function computeDeal(input: DealComputationInput): DealComputation {
  const { amountFiat, rate, merchantPercent, traderPercent } = input;
  const leads = input.leads ?? [];

  const leadSum = roundMoney(
    leads.reduce((sum, lead) => sum + lead.percent, 0),
  );
  const shortfallPercent =
    leads.length === 0
      ? 0
      : roundMoney(
          Math.max(
            0,
            input.platformMinPercent -
              (merchantPercent - traderPercent - leadSum),
          ),
        );

  if (shortfallPercent > traderPercent) {
    throw new PlatformMinimumUnreachableError();
  }

  const traderEffectivePercent = roundMoney(traderPercent - shortfallPercent);
  const traderFraction = traderEffectivePercent / 100;

  const amountCrypto = roundMoney(amountFiat / rate);
  const merchantCommission = roundMoney(amountCrypto * (merchantPercent / 100));
  const leadShares: DealLeadShare[] = leads.map((lead) => ({
    leadUserId: lead.leadUserId,
    percent: lead.percent,
    amount: roundMoney(amountCrypto * (lead.percent / 100)),
  }));
  const hasLeads = leadShares.length > 0;
  const leadPercent = hasLeads ? leadSum : null;
  const leadCommission = hasLeads
    ? roundMoney(leadShares.reduce((sum, share) => sum + share.amount, 0))
    : null;

  const shared = {
    amountCrypto,
    merchantCommission,
    traderEffectivePercent,
    shortfallPercent,
    leadPercent,
    leadCommission,
    leadShares,
  };

  if (input.kind === TransactionKind.PayIn) {
    const traderAmount = roundMoney(amountFiat / (rate * (1 + traderFraction)));
    const traderCommission = roundMoney(Math.abs(amountCrypto - traderAmount));
    const merchantAmount = roundMoney(amountCrypto - merchantCommission);

    return { ...shared, traderCommission, traderAmount, merchantAmount };
  }

  const traderCommission = roundMoney(amountCrypto * traderFraction);
  const traderAmount = roundMoney(amountCrypto + traderCommission);
  const merchantAmount = roundMoney(amountCrypto + merchantCommission);

  return { ...shared, traderCommission, traderAmount, merchantAmount };
}

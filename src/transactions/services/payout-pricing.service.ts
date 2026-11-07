import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserTeamService } from '../../users/services/user-team.service';
import { Transaction } from '../entities/transaction.entity';
import { PricedPayOut } from '../types/priced-pay-out';
import { RateScope } from '../types/rate-scope.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import {
  computeDeal,
  PlatformMinimumUnreachableError,
} from '../utils/compute-deal';
import { findTransactionMethod } from '../utils/find-transaction-method';
import { RateService } from './rate.service';

@Injectable()
export class PayoutPricingService {
  constructor(
    private readonly rates: RateService,
    private readonly team: UserTeamService,
    private readonly config: ConfigService,
  ) {}

  async priceFor(
    deal: Transaction,
    traderUserId: string,
    individualRatesEnabled: boolean,
  ): Promise<PricedPayOut | null> {
    const [traderPercent] = await this.rates.resolveSubjectPercents(
      {
        scope: RateScope.Trader,
        method: deal.method,
        amount: deal.amountFiat,
        direction: 'payOut',
      },
      [
        {
          userId: traderUserId,
          individualEnabled: individualRatesEnabled,
          bankId: deal.payoutBankId,
        },
      ],
    );

    if (traderPercent === null) return null;

    const leads = await this.rates.resolveLeadPercents({
      links: await this.team.assignmentsOf(traderUserId),
      method: deal.method,
      amount: deal.amountFiat,
      bankId: deal.payoutBankId,
      direction: 'payOut',
    });

    try {
      const computation = computeDeal({
        kind: TransactionKind.PayOut,
        amountFiat: deal.amountFiat,
        rate: deal.rate,
        merchantPercent: deal.merchantPercent,
        traderPercent,
        platformMinPercent:
          findTransactionMethod(deal.method)?.platformMinPercent ??
          this.config.getOrThrow<number>('PLATFORM_MIN_PERCENT'),
        leads,
      });

      const paidOut = computation.traderAmount.plus(
        computation.leadCommission ?? 0,
      );

      return paidOut.gt(deal.merchantAmount)
        ? null
        : { ...computation, traderPercent };
    } catch (error) {
      if (error instanceof PlatformMinimumUnreachableError) return null;
      throw error;
    }
  }
}

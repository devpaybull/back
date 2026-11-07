import { AuthenticatedUser } from '../../common/types/token';
import { TraderDealActor } from '../../transactions/types/trader-deal-actor';

export const traderActorOf = (user: AuthenticatedUser): TraderDealActor => ({
  traderUserId: user.id,
  impersonatorUserId: user.impersonatedBy ?? null,
});

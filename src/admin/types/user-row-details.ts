import { MethodPercent } from '../../transactions/types/method-percent';
import { RateSummary } from '../../transactions/types/rate-summary';
import { TeamMember } from '../../users/types/team-member';
import { BalancesDto } from '../dto/balances.dto';
import { UserMerchantDto } from '../dto/user-merchant.dto';
import { TradingStatus } from './trading-status.enum';

export interface UserRowDetails {
  balances: BalancesDto | null;
  insurancePayInMin: string | null;
  insurancePayOutMin: string | null;
  tradingStatus: TradingStatus | null;
  rates: MethodPercent[] | null;
  rateSummary: RateSummary[] | null;
  leads: TeamMember[] | null;
  subordinates: TeamMember[] | null;
  merchant: UserMerchantDto | null;
}

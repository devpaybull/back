import { MethodPercent } from '../../transactions/types/method-percent';
import { TeamMember } from '../../users/types/team-member';
import { BalancesDto } from '../dto/balances.dto';
import { UserMerchantDto } from '../dto/user-merchant.dto';

export interface UserRowDetails {
  balances: BalancesDto | null;
  insurancePayInMin: string | null;
  rates: MethodPercent[] | null;
  leads: TeamMember[] | null;
  subordinates: TeamMember[] | null;
  merchant: UserMerchantDto | null;
}

import { UsdtTransferInspection } from '../../tron/types/usdt-transfer-inspection';
import { HashCreditCandidate } from './hash-credit-candidate';

export interface HashCreditPlan {
  inspection: UsdtTransferInspection;
  candidates: HashCreditCandidate[];
  refusal: Error | null;
}

import { UsdtTransferInspection } from '../../tron/types/usdt-transfer-inspection';

export interface WithdrawalVerification {
  inspection: UsdtTransferInspection;
  completable: boolean;
  amountSent: string | null;
  reason: string | null;
}

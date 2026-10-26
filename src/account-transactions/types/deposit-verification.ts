import { UsdtTransferInspection } from '../../tron/types/usdt-transfer-inspection';

export interface DepositVerification {
  inspection: UsdtTransferInspection;
  creditable: boolean;
  amount: string | null;
  reason: string | null;
}

import { UsdtTransferEvent } from '../../tron/types/usdt-transfer-event';

export interface HashCreditCandidate {
  userId: string;
  address: string;
  addressId: number;
  transfers: UsdtTransferEvent[];
  alreadyCredited: boolean;
}

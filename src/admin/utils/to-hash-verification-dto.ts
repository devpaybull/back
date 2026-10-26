import { formatCrypto } from '../../common/utils/format-crypto';
import { UsdtTransferInspection } from '../../tron/types/usdt-transfer-inspection';
import { HashVerificationDto } from '../dto/usdt-transfer-inspection.dto';

export const toHashVerificationDto = (
  inspection: UsdtTransferInspection,
  acceptable: boolean,
  amount: string | null,
  reason: string | null,
): HashVerificationDto => ({
  status: inspection.status,
  transfers: inspection.transfers.map((transfer) => ({
    ...transfer,
    amount: formatCrypto(transfer.amount),
  })),
  acceptable,
  amount,
  reason,
});

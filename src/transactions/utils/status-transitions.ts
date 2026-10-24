import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const payIn: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
  [TransactionStatus.Active]: [
    TransactionStatus.Checking,
    TransactionStatus.Success,
    TransactionStatus.Canceled,
    TransactionStatus.Dispute,
  ],
  [TransactionStatus.Checking]: [
    TransactionStatus.CheckingManually,
    TransactionStatus.Success,
    TransactionStatus.Canceled,
  ],
  [TransactionStatus.CheckingManually]: [
    TransactionStatus.Success,
    TransactionStatus.Canceled,
    TransactionStatus.Dispute,
  ],
  [TransactionStatus.Dispute]: [TransactionStatus.ManualReview],
  [TransactionStatus.ManualReview]: [
    TransactionStatus.Success,
    TransactionStatus.SuccessChanged,
    TransactionStatus.Canceled,
  ],
};

const payOut: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
  [TransactionStatus.Pending]: [
    TransactionStatus.Active,
    TransactionStatus.Canceled,
  ],
  [TransactionStatus.Active]: [
    TransactionStatus.Success,
    TransactionStatus.Canceled,
    TransactionStatus.Pending,
    TransactionStatus.Dispute,
  ],
  [TransactionStatus.Dispute]: [TransactionStatus.ManualReview],
  [TransactionStatus.ManualReview]: [
    TransactionStatus.Success,
    TransactionStatus.SuccessChanged,
    TransactionStatus.Canceled,
  ],
};

const internalTransfer: Partial<
  Record<TransactionStatus, TransactionStatus[]>
> = {
  [TransactionStatus.Active]: [
    TransactionStatus.Success,
    TransactionStatus.Canceled,
  ],
};

const transitions: Record<
  TransactionKind,
  Partial<Record<TransactionStatus, TransactionStatus[]>>
> = {
  [TransactionKind.PayIn]: payIn,
  [TransactionKind.PayOut]: payOut,
  [TransactionKind.InternalTransfer]: internalTransfer,
};

export const FINAL_STATUSES: readonly TransactionStatus[] = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
  TransactionStatus.Canceled,
];

export function isFinalStatus(status: TransactionStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

export function startStatus(kind: TransactionKind): TransactionStatus {
  return kind === TransactionKind.PayOut
    ? TransactionStatus.Pending
    : TransactionStatus.Active;
}

export function canTransition(
  kind: TransactionKind,
  from: TransactionStatus,
  to: TransactionStatus,
): boolean {
  return (transitions[kind][from] ?? []).includes(to);
}

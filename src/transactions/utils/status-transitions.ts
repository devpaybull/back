import { StatusEventSource } from '../types/status-event-source.enum';
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
  [TransactionStatus.Checking]: [
    TransactionStatus.Success,
    TransactionStatus.Dispute,
  ],
  [TransactionStatus.Dispute]: [TransactionStatus.ManualReview],
  [TransactionStatus.ManualReview]: [
    TransactionStatus.Success,
    TransactionStatus.SuccessChanged,
    TransactionStatus.Canceled,
  ],
};

const traderPayIn: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
  [TransactionStatus.Active]: [TransactionStatus.SuccessChanged],
  [TransactionStatus.Checking]: [TransactionStatus.SuccessChanged],
  [TransactionStatus.CheckingManually]: [TransactionStatus.SuccessChanged],
};

const traderPayOut: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
  [TransactionStatus.Active]: [TransactionStatus.Checking],
};

const traderOnly: Record<
  TransactionKind,
  Partial<Record<TransactionStatus, TransactionStatus[]>>
> = {
  [TransactionKind.PayIn]: traderPayIn,
  [TransactionKind.PayOut]: traderPayOut,
};

const transitions: Record<
  TransactionKind,
  Partial<Record<TransactionStatus, TransactionStatus[]>>
> = {
  [TransactionKind.PayIn]: payIn,
  [TransactionKind.PayOut]: payOut,
};

export const FINAL_STATUSES: readonly TransactionStatus[] = [
  TransactionStatus.Success,
  TransactionStatus.SuccessChanged,
  TransactionStatus.Canceled,
];

const expiryTargets: Record<
  TransactionKind,
  Partial<Record<TransactionStatus, TransactionStatus>>
> = {
  [TransactionKind.PayIn]: {
    [TransactionStatus.Active]: TransactionStatus.Canceled,
    [TransactionStatus.Checking]: TransactionStatus.CheckingManually,
  },
  [TransactionKind.PayOut]: {
    [TransactionStatus.Pending]: TransactionStatus.Canceled,
    [TransactionStatus.Active]: TransactionStatus.Canceled,
  },
};

export function tickingStatuses(kind: TransactionKind): TransactionStatus[] {
  return Object.keys(expiryTargets[kind]) as TransactionStatus[];
}

export const TICKING_STATUSES: readonly TransactionStatus[] = [
  ...new Set(Object.values(TransactionKind).flatMap(tickingStatuses)),
];

export function expiryTarget(
  kind: TransactionKind,
  status: TransactionStatus,
): TransactionStatus | undefined {
  return expiryTargets[kind][status];
}

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
  source?: StatusEventSource,
): boolean {
  return (
    (transitions[kind][from] ?? []).includes(to) ||
    (source === StatusEventSource.Trader &&
      (traderOnly[kind][from] ?? []).includes(to))
  );
}

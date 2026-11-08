import { DeviceMatchOutcome } from './device-match-outcome.enum';

export interface DeviceConfirmation {
  outcome: DeviceMatchOutcome;
  transactionId: string | null;
}

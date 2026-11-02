import { Counterparty } from '../entities/counterparty.entity';
import { CounterpartyHealth } from '../types/counterparty-health.enum';

export function counterpartyHealth(
  counterparty: Pick<Counterparty, 'enabled' | 'blacklistedAt'>,
): CounterpartyHealth {
  if (counterparty.blacklistedAt) return CounterpartyHealth.Blacklisted;

  return counterparty.enabled
    ? CounterpartyHealth.Active
    : CounterpartyHealth.Disabled;
}

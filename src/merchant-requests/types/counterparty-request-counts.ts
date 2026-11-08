import { CounterpartyDayRequests } from '../../counterparties/types/counterparty-day-requests';
import { CounterpartyRequestTotals } from '../../counterparties/types/counterparty-request-totals';

export interface CounterpartyRequestCounts {
  totals: CounterpartyRequestTotals[];
  days: CounterpartyDayRequests[];
}

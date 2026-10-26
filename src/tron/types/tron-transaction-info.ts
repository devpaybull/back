import { TronLog } from './tron-log';

export interface TronTransactionInfo {
  id: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  contract_address?: string;
  fee?: number;
  receipt?: {
    result?: string;
    energy_usage?: number;
    energy_usage_total?: number;
    energy_fee?: number;
    net_usage?: number;
    net_fee?: number;
  };
  log?: TronLog[];
  result?: string;
  resMessage?: string;
}

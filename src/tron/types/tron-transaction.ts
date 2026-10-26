export interface TronContractParameter {
  value: Record<string, unknown>;
  type_url: string;
}

export interface TronTransaction {
  txID: string;
  raw_data: {
    contract: { parameter: TronContractParameter; type: string }[];
    ref_block_bytes: string;
    ref_block_hash: string;
    expiration: number;
    timestamp: number;
    fee_limit?: number;
  };
  raw_data_hex: string;
  signature?: string[];
  visible?: boolean;
}

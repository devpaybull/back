import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TronWeb } from 'tronweb';
import { AccountResources } from '../types/account-resources';
import { ChainParameters } from '../types/chain-parameters';
import { TronTransaction } from '../types/tron-transaction';
import { TronTransactionInfo } from '../types/tron-transaction-info';
import { TronUnavailableError } from '../types/tron-unavailable.error';

const REQUEST_TIMEOUT_MS = 10_000;
const ENERGY_RESOURCE = 'ENERGY';

interface ChainParameterEntry {
  key: string;
  value?: number;
}

@Injectable()
export class TronNodeClient {
  private chainParameters: {
    value: ChainParameters;
    expiresAt: number;
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  async getSolidifiedBlockNumber(): Promise<number> {
    const block = await this.post<{
      block_header?: { raw_data?: { number?: number } };
    }>('walletsolidity/getnowblock', {});
    const number = block.block_header?.raw_data?.number;

    if (typeof number !== 'number') {
      throw new TronUnavailableError('The node returned no solidified block');
    }

    return number;
  }

  async getSolidifiedTransactionInfos(
    blockNumber: number,
  ): Promise<TronTransactionInfo[]> {
    const infos = await this.post<TronTransactionInfo[] | object>(
      'walletsolidity/gettransactioninfobyblocknum',
      { num: blockNumber },
    );

    if (Array.isArray(infos)) return infos;

    if (Object.keys(infos).length === 0) return [];

    throw new TronUnavailableError(
      `The node returned no transaction infos for block ${blockNumber}`,
    );
  }

  async getSolidifiedBlockTransactionCount(
    blockNumber: number,
  ): Promise<number> {
    const block = await this.post<{
      block_header?: { raw_data?: { number?: number } };
      transactions?: unknown[];
    }>('walletsolidity/getblockbynum', { num: blockNumber });

    if (block.block_header?.raw_data?.number !== blockNumber) {
      throw new TronUnavailableError(
        `The node does not have solidified block ${blockNumber}`,
      );
    }

    return block.transactions?.length ?? 0;
  }

  async getSolidifiedTransactionInfo(
    txHash: string,
  ): Promise<TronTransactionInfo | null> {
    const info = await this.post<TronTransactionInfo | object>(
      'walletsolidity/gettransactioninfobyid',
      { value: txHash },
    );

    return 'id' in info ? info : null;
  }

  async getTransaction(txHash: string): Promise<TronTransaction | null> {
    const transaction = await this.post<TronTransaction | object>(
      'wallet/gettransactionbyid',
      { value: txHash, visible: true },
    );

    return 'txID' in transaction ? transaction : null;
  }

  async getChainParameters(): Promise<ChainParameters> {
    const now = Date.now();

    if (this.chainParameters && this.chainParameters.expiresAt > now) {
      return this.chainParameters.value;
    }

    const response = await this.post<{
      chainParameter?: ChainParameterEntry[];
    }>('wallet/getchainparameters', {});
    const read = (key: string): number => {
      const entry = response.chainParameter?.find((item) => item.key === key);

      if (typeof entry?.value !== 'number') {
        throw new TronUnavailableError(`The node did not report ${key}`);
      }

      return entry.value;
    };
    const value: ChainParameters = {
      energyFeeSun: read('getEnergyFee'),
      bandwidthFeeSun: read('getTransactionFee'),
      createAccountFeeSun: read('getCreateNewAccountFeeInSystemContract'),
    };
    const ttl = this.config.get<number>('TRON_CHAIN_PARAMS_TTL_SECONDS', 600);
    this.chainParameters = { value, expiresAt: now + ttl * 1000 };

    return value;
  }

  async getAccountResources(address: string): Promise<AccountResources> {
    const resources = await this.post<Record<string, number | undefined>>(
      'wallet/getaccountresource',
      { address, visible: true },
    );

    return {
      energyLimit: resources.EnergyLimit ?? 0,
      energyUsed: resources.EnergyUsed ?? 0,
      freeBandwidthLimit: resources.freeNetLimit ?? 0,
      freeBandwidthUsed: resources.freeNetUsed ?? 0,
      bandwidthLimit: resources.NetLimit ?? 0,
      bandwidthUsed: resources.NetUsed ?? 0,
      totalEnergyLimit: resources.TotalEnergyLimit ?? 0,
      totalEnergyWeight: resources.TotalEnergyWeight ?? 0,
    };
  }

  async isActivated(address: string): Promise<boolean> {
    const account = await this.post<{ address?: string }>('wallet/getaccount', {
      address,
      visible: true,
    });

    return Boolean(account.address);
  }

  async getTrxBalanceSun(address: string): Promise<string> {
    const account = await this.post<{ balance?: number }>('wallet/getaccount', {
      address,
      visible: true,
    });

    return String(account.balance ?? 0);
  }

  async getDelegatableEnergySun(owner: string): Promise<string> {
    const response = await this.post<{ max_size?: number }>(
      'wallet/getcandelegatedmaxsize',
      { owner_address: owner, type: 1, visible: true },
    );

    return String(response.max_size ?? 0);
  }

  async getUsdtBalanceSun(address: string): Promise<string> {
    const response = await this.post<{ constant_result?: string[] }>(
      'wallet/triggerconstantcontract',
      {
        owner_address: address,
        contract_address: this.usdtContract,
        function_selector: 'balanceOf(address)',
        parameter: this.addressParameter(address),
        visible: true,
      },
    );
    const [result] = response.constant_result ?? [];

    if (result === undefined) {
      throw new TronUnavailableError('The node returned no USDT balance');
    }

    return BigInt(`0x${result || '0'}`).toString();
  }

  async estimateUsdtTransferEnergy(
    from: string,
    to: string,
    amountSun: string,
  ): Promise<number> {
    const response = await this.post<{
      energy_used?: number;
      result?: { result?: boolean; message?: string };
    }>('wallet/triggerconstantcontract', {
      owner_address: from,
      contract_address: this.usdtContract,
      function_selector: 'transfer(address,uint256)',
      parameter: this.transferParameter(to, amountSun),
      visible: true,
    });

    if (typeof response.energy_used !== 'number') {
      throw new TronUnavailableError('The node returned no energy estimate');
    }

    return response.energy_used;
  }

  async buildUsdtTransfer(
    from: string,
    to: string,
    amountSun: string,
    feeLimitSun: string,
  ): Promise<TronTransaction> {
    const response = await this.post<{
      transaction?: TronTransaction;
      result?: { result?: boolean; message?: string };
    }>('wallet/triggersmartcontract', {
      owner_address: from,
      contract_address: this.usdtContract,
      function_selector: 'transfer(address,uint256)',
      parameter: this.transferParameter(to, amountSun),
      fee_limit: Number(feeLimitSun),
      call_value: 0,
      visible: true,
    });

    if (!response.transaction) {
      throw new TronUnavailableError(
        `The node refused to build a USDT transfer: ${response.result?.message ?? 'no transaction'}`,
      );
    }

    return response.transaction;
  }

  buildTrxTransfer(
    from: string,
    to: string,
    amountSun: string,
  ): Promise<TronTransaction> {
    return this.build('wallet/createtransaction', {
      owner_address: from,
      to_address: to,
      amount: Number(amountSun),
      visible: true,
    });
  }

  buildEnergyDelegation(
    owner: string,
    receiver: string,
    balanceSun: string,
  ): Promise<TronTransaction> {
    return this.build('wallet/delegateresource', {
      owner_address: owner,
      receiver_address: receiver,
      balance: Number(balanceSun),
      resource: ENERGY_RESOURCE,
      lock: false,
      visible: true,
    });
  }

  buildEnergyUndelegation(
    owner: string,
    receiver: string,
    balanceSun: string,
  ): Promise<TronTransaction> {
    return this.build('wallet/undelegateresource', {
      owner_address: owner,
      receiver_address: receiver,
      balance: Number(balanceSun),
      resource: ENERGY_RESOURCE,
      visible: true,
    });
  }

  async broadcast(transaction: TronTransaction): Promise<void> {
    const response = await this.post<{
      result?: boolean;
      code?: string;
      message?: string;
    }>('wallet/broadcasttransaction', transaction);

    if (!response.result && response.code !== 'DUP_TRANSACTION_ERROR') {
      throw new TronUnavailableError(
        `Broadcast refused: ${response.code ?? 'unknown'}`,
      );
    }
  }

  private async build(
    path: string,
    body: Record<string, unknown>,
  ): Promise<TronTransaction> {
    const transaction = await this.post<TronTransaction & { Error?: string }>(
      path,
      body,
    );

    if (!transaction.txID) {
      throw new TronUnavailableError(
        `The node refused ${path}: ${transaction.Error ?? 'no transaction'}`,
      );
    }

    return transaction;
  }

  private get usdtContract(): string {
    return this.config.getOrThrow<string>('TRON_USDT_CONTRACT');
  }

  private addressParameter(address: string): string {
    return TronWeb.address.toHex(address).slice(2).padStart(64, '0');
  }

  private transferParameter(to: string, amountSun: string): string {
    return (
      this.addressParameter(to) +
      BigInt(amountSun).toString(16).padStart(64, '0')
    );
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const url = `${this.config.getOrThrow<string>('TRON_API_URL').replace(/\/$/, '')}/${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'TRON-PRO-API-KEY': this.config.getOrThrow<string>('TRON_API_KEY'),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TronUnavailableError(
        `Tron node unreachable on ${path}: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new TronUnavailableError(
        `Tron node answered ${response.status} on ${path}`,
      );
    }

    return (await response.json()) as T;
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Crypto } from '../../common/types/crypto';
import { UsdtTransferInspection } from '../types/usdt-transfer-inspection';
import { fromSun } from '../utils/from-sun';
import { isSuccessfulTransaction } from '../utils/is-successful-transaction';
import { parseUsdtTransfers } from '../utils/parse-usdt-transfers';
import { TronNodeClient } from './tron-node.client';

@Injectable()
export class TronVerifier {
  constructor(
    private readonly config: ConfigService,
    private readonly node: TronNodeClient,
  ) {}

  async inspectUsdtTransfer(txHash: string): Promise<UsdtTransferInspection> {
    const info = await this.node.getSolidifiedTransactionInfo(txHash);

    if (!info) {
      const pending = await this.node.getTransaction(txHash);

      return { status: pending ? 'pending' : 'not_found', transfers: [] };
    }

    if (!isSuccessfulTransaction(info)) {
      return { status: 'failed', transfers: [] };
    }

    const transfers = parseUsdtTransfers(
      info,
      this.config.getOrThrow<string>('TRON_USDT_CONTRACT'),
    );

    return transfers.length === 0
      ? { status: 'not_usdt', transfers: [] }
      : { status: 'confirmed', transfers };
  }

  async usdtBalanceOf(address: string): Promise<Crypto> {
    return fromSun(await this.node.getUsdtBalanceSun(address));
  }
}

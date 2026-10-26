import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { TronWeb, utils } from 'tronweb';
import { DataSource, Like, Not } from 'typeorm';
import { toCrypto } from '../../common/utils/to-crypto';
import { TronOutgoingTransfer } from '../entities/tron-outgoing-transfer.entity';
import { BuiltTransactionCheck } from '../types/built-transaction-check';
import { DelegateEnergyInput } from '../types/delegate-energy-input';
import { OutgoingTransferKind } from '../types/outgoing-transfer-kind.enum';
import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';
import { SendTrxInput } from '../types/send-trx-input';
import { SendUsdtInput } from '../types/send-usdt-input';
import { SigningKeyRef } from '../types/signing-key-ref';
import {
  TRANSACTION_SIGNER,
  TransactionSigner,
} from '../types/transaction-signer';
import { TronTransaction } from '../types/tron-transaction';
import { toSun } from '../utils/to-sun';
import { TronKeyring } from './tron-keyring.service';
import { TronNodeClient } from './tron-node.client';

interface SendPlan {
  idempotencyKey: string;
  kind: OutgoingTransferKind;
  key: SigningKeyRef;
  to: string;
  amountSun: string;
  feeLimitSun: string | null;
  build: (from: string) => Promise<TronTransaction>;
  expect: (from: string) => BuiltTransactionCheck;
}

const USDT_TRANSFER_SELECTOR = 'a9059cbb';
const MAX_EXPIRATION_MS = 600_000;

@Injectable()
export class TronSender {
  constructor(
    private readonly config: ConfigService,
    private readonly node: TronNodeClient,
    private readonly keyring: TronKeyring,
    @Inject(TRANSACTION_SIGNER) private readonly signer: TransactionSigner,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  sendUsdt(input: SendUsdtInput): Promise<TronOutgoingTransfer> {
    const amountSun = toSun(input.amount);
    const feeLimitSun = toSun(
      toCrypto(this.config.getOrThrow<string>('TRON_MAX_TRX_BURN_PER_TX')),
    );
    const contract = this.config.getOrThrow<string>('TRON_USDT_CONTRACT');

    return this.send({
      idempotencyKey: input.idempotencyKey,
      kind: OutgoingTransferKind.Usdt,
      key: input.from,
      to: input.to,
      amountSun,
      feeLimitSun,
      build: (from) =>
        this.node.buildUsdtTransfer(from, input.to, amountSun, feeLimitSun),
      expect: (from) => ({
        type: 'TriggerSmartContract',
        value: {
          owner_address: from,
          contract_address: contract,
          data:
            USDT_TRANSFER_SELECTOR +
            TronWeb.address.toHex(input.to).slice(2).padStart(64, '0') +
            BigInt(amountSun).toString(16).padStart(64, '0'),
        },
        feeLimitSun,
      }),
    });
  }

  sendTrx(input: SendTrxInput): Promise<TronOutgoingTransfer> {
    const amountSun = toSun(input.amount);

    return this.send({
      idempotencyKey: input.idempotencyKey,
      kind: OutgoingTransferKind.Trx,
      key: input.from,
      to: input.to,
      amountSun,
      feeLimitSun: null,
      build: (from) => this.node.buildTrxTransfer(from, input.to, amountSun),
      expect: (from) => ({
        type: 'TransferContract',
        value: {
          owner_address: from,
          to_address: input.to,
          amount: Number(amountSun),
        },
      }),
    });
  }

  delegateEnergy(input: DelegateEnergyInput): Promise<TronOutgoingTransfer> {
    return this.send({
      idempotencyKey: input.idempotencyKey,
      kind: OutgoingTransferKind.Delegate,
      key: { kind: 'energy' },
      to: input.receiver,
      amountSun: input.balanceSun,
      feeLimitSun: null,
      build: (from) =>
        this.node.buildEnergyDelegation(from, input.receiver, input.balanceSun),
      expect: (from) => ({
        type: 'DelegateResourceContract',
        value: {
          owner_address: from,
          receiver_address: input.receiver,
          balance: Number(input.balanceSun),
          resource: 'ENERGY',
        },
      }),
    });
  }

  undelegateEnergy(input: DelegateEnergyInput): Promise<TronOutgoingTransfer> {
    return this.send({
      idempotencyKey: input.idempotencyKey,
      kind: OutgoingTransferKind.Undelegate,
      key: { kind: 'energy' },
      to: input.receiver,
      amountSun: input.balanceSun,
      feeLimitSun: null,
      build: (from) =>
        this.node.buildEnergyUndelegation(
          from,
          input.receiver,
          input.balanceSun,
        ),
      expect: (from) => ({
        type: 'UnDelegateResourceContract',
        value: {
          owner_address: from,
          receiver_address: input.receiver,
          balance: Number(input.balanceSun),
          resource: 'ENERGY',
        },
      }),
    });
  }

  findByKey(idempotencyKey: string): Promise<TronOutgoingTransfer | null> {
    return this.dataSource
      .getRepository(TronOutgoingTransfer)
      .findOne({ where: { idempotencyKey } });
  }

  isHashUsedOutside(txHash: string, keyPrefix: string): Promise<boolean> {
    return this.dataSource.getRepository(TronOutgoingTransfer).exists({
      where: { txHash, idempotencyKey: Not(Like(`${keyPrefix}%`)) },
    });
  }

  private async send(plan: SendPlan): Promise<TronOutgoingTransfer> {
    const repository = this.dataSource.getRepository(TronOutgoingTransfer);
    const existing = await repository.findOne({
      where: { idempotencyKey: plan.idempotencyKey },
    });

    if (existing) return existing;

    const from = await this.addressOf(plan.key);
    const inserted = await repository
      .createQueryBuilder()
      .insert()
      .values({
        idempotencyKey: plan.idempotencyKey,
        kind: plan.kind,
        fromAddress: from,
        toAddress: plan.to,
        amountSun: plan.amountSun,
        feeLimitSun: plan.feeLimitSun,
        status: OutgoingTransferStatus.Building,
      })
      .orIgnore()
      .execute();

    const row = await repository.findOneOrFail({
      where: { idempotencyKey: plan.idempotencyKey },
    });

    if (
      (inserted.raw as unknown[]).length === 0 ||
      row.status !== OutgoingTransferStatus.Building
    ) {
      return row;
    }

    let signed: TronTransaction;

    try {
      const built = await plan.build(from);
      this.assertBuiltAsRequested(built, plan.expect(from));
      signed = await this.signer.sign(built, plan.key);
    } catch (error) {
      row.status = OutgoingTransferStatus.Failed;
      row.failureReason = `not sent: ${(error as Error).message}`;
      await repository.save(row);
      throw error;
    }

    row.txHash = signed.txID;
    row.status = OutgoingTransferStatus.Signed;
    row.expiresAt = new Date(signed.raw_data.expiration);
    await repository.save(row);

    try {
      await this.node.broadcast(signed);
    } catch {
      return row;
    }

    row.status = OutgoingTransferStatus.Broadcast;
    row.broadcastAt = new Date();

    return repository.save(row);
  }

  private addressOf(key: SigningKeyRef): Promise<string> {
    switch (key.kind) {
      case 'hot':
        return this.keyring.hotAddress();
      case 'energy':
        return this.keyring.energyAddress();
      case 'deposit':
        return this.keyring.depositAddressAt(key.derivationIndex);
    }
  }

  private assertBuiltAsRequested(
    transaction: TronTransaction,
    expected: BuiltTransactionCheck,
  ): void {
    const contracts = transaction.raw_data?.contract ?? [];
    const [contract] = contracts;
    const value = contract?.parameter?.value ?? {};
    const now = Date.now();
    const expiration = transaction.raw_data?.expiration ?? 0;
    const mismatch =
      !utils.transaction.txCheck(transaction as never) ||
      contracts.length !== 1 ||
      contract.type !== expected.type ||
      Object.entries(expected.value).some(([field, wanted]) =>
        field === 'data'
          ? String(value[field]).toLowerCase() !== String(wanted).toLowerCase()
          : String(value[field]) !== String(wanted),
      ) ||
      Number(value.call_value ?? 0) !== 0 ||
      Number(value.call_token_value ?? 0) !== 0 ||
      Number(value.token_id ?? 0) !== 0 ||
      'Permission_id' in contract ||
      expiration <= now ||
      expiration > now + MAX_EXPIRATION_MS ||
      (expected.feeLimitSun !== undefined &&
        String(transaction.raw_data.fee_limit) !== expected.feeLimitSun);

    if (mismatch) {
      throw new Error(
        'The node built a transaction other than the one requested',
      );
    }
  }
}

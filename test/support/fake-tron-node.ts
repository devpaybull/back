import { randomBytes } from 'crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { TronWeb, utils } from 'tronweb';

const TRANSFER_TOPIC =
  'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ENERGY_FEE_SUN = 210;
const BANDWIDTH_FEE_SUN = 1000;
const TOTAL_ENERGY_LIMIT = 90_000_000_000;
const TOTAL_ENERGY_WEIGHT = 10_000_000_000;
const ENERGY_PER_TRX = TOTAL_ENERGY_LIMIT / TOTAL_ENERGY_WEIGHT;

type Json = Record<string, unknown>;

interface StoredTransaction {
  transaction: Json & { txID: string };
  info: Json;
  blockNumber: number;
}

export type BuildTamper = 'recipient' | 'hex' | null;

const hex40 = (address: string): string =>
  TronWeb.address.toHex(address).slice(2).toLowerCase();

const pad64 = (hex: string): string => hex.padStart(64, '0');

export class FakeTronNode {
  readonly usdtContract = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
  head = 1000;
  usdt = new Map<string, bigint>();
  trx = new Map<string, bigint>();
  activated = new Set<string>();
  ownEnergy = new Map<string, number>();
  delegatableSun = new Map<string, bigint>();
  blocks = new Map<number, StoredTransaction[]>();
  byId = new Map<string, StoredTransaction>();
  pending = new Map<string, Json & { txID: string }>();
  broadcasts: (Json & { txID: string })[] = [];
  nextBuildTamper: BuildTamper = null;
  nextResult: 'SUCCESS' | 'REVERT' | null = null;
  dropInfosOfBlock: number | null = null;
  failBroadcasts = false;
  requests: { path: string; apiKey: string | undefined }[] = [];
  private server: Server | null = null;

  get url(): string {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async start(): Promise<void> {
    this.server = createServer(
      (request, response) => void this.handle(request, response),
    );
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  usdtOf(address: string): bigint {
    return this.usdt.get(address) ?? 0n;
  }

  trxOf(address: string): bigint {
    return this.trx.get(address) ?? 0n;
  }

  externalUsdtTransfer(
    from: string,
    to: string,
    amountSun: bigint,
    result: 'SUCCESS' | 'REVERT' = 'SUCCESS',
  ): string {
    const id = randomBytes(32).toString('hex');
    const block = this.newBlock();

    if (result === 'SUCCESS') {
      this.usdt.set(from, this.usdtOf(from) - amountSun);
      this.usdt.set(to, this.usdtOf(to) + amountSun);
    }

    this.store(
      block,
      { txID: id, raw_data: { contract: [] } },
      {
        id,
        blockNumber: block,
        blockTimeStamp: Date.now(),
        fee: 0,
        receipt: { result },
        log: [this.transferLog(from, to, amountSun)],
      },
    );

    return id;
  }

  mine(): number {
    const block = this.newBlock();

    for (const transaction of this.pending.values()) {
      this.store(block, transaction, this.execute(transaction, block));
    }

    this.pending.clear();
    return block;
  }

  private newBlock(): number {
    this.head += 1;
    this.blocks.set(this.head, []);
    return this.head;
  }

  private store(
    block: number,
    transaction: Json & { txID: string },
    info: Json,
  ) {
    const stored = { transaction, info, blockNumber: block };
    this.blocks.get(block)!.push(stored);
    this.byId.set(transaction.txID, stored);
  }

  private transferLog(from: string, to: string, amountSun: bigint): Json {
    return {
      address: hex40(this.usdtContract),
      topics: [TRANSFER_TOPIC, pad64(hex40(from)), pad64(hex40(to))],
      data: pad64(amountSun.toString(16)),
    };
  }

  private execute(transaction: Json & { txID: string }, block: number): Json {
    const raw = transaction.raw_data as Json;
    const [contract] = raw.contract as {
      type: string;
      parameter: { value: Json };
    }[];
    const value = contract.parameter.value;
    const owner = String(value.owner_address);
    const base = {
      id: transaction.txID,
      blockNumber: block,
      blockTimeStamp: Date.now(),
    };

    if (contract.type === 'TransferContract') {
      const amount = BigInt(value.amount as number);
      const to = String(value.to_address);
      const fee = this.activated.has(to) ? 0n : 1_000_000n;

      if (this.trxOf(owner) < amount + fee) {
        return {
          ...base,
          result: 'FAILED',
          receipt: { result: 'FAILED' },
          fee: 0,
        };
      }

      this.trx.set(owner, this.trxOf(owner) - amount - fee);
      this.trx.set(to, this.trxOf(to) + amount);
      this.activated.add(to);

      return { ...base, fee: Number(fee), receipt: { net_usage: 268 } };
    }

    if (
      contract.type === 'DelegateResourceContract' ||
      contract.type === 'UnDelegateResourceContract'
    ) {
      const balance = BigInt(value.balance as number);
      const receiver = String(value.receiver_address);
      const energy = (Number(balance) / 1_000_000) * ENERGY_PER_TRX;
      const sign = contract.type === 'DelegateResourceContract' ? 1 : -1;
      this.ownEnergy.set(
        receiver,
        (this.ownEnergy.get(receiver) ?? 0) + sign * energy,
      );
      this.delegatableSun.set(
        owner,
        (this.delegatableSun.get(owner) ?? 0n) - BigInt(sign) * balance,
      );

      return { ...base, fee: 0, receipt: { net_usage: 280 } };
    }

    const data = String(value.data);
    const to = TronWeb.address.fromHex(`41${data.slice(32, 72)}`);
    const amount = BigInt(`0x${data.slice(72)}`);
    const energy = this.usdtOf(to) > 0n ? 65_000 : 130_000;
    const forced = this.nextResult;
    this.nextResult = null;
    const ownEnergy = this.ownEnergy.get(owner) ?? 0;
    const burnSun =
      ownEnergy >= energy ? 0n : BigInt((energy - ownEnergy) * ENERGY_FEE_SUN);
    const failed =
      forced === 'REVERT' ||
      this.usdtOf(owner) < amount ||
      this.trxOf(owner) < burnSun;

    if (failed) {
      return {
        ...base,
        fee: 0,
        result: 'FAILED',
        receipt: {
          result: forced ?? 'OUT_OF_ENERGY',
          energy_usage_total: energy,
        },
        log: [],
      };
    }

    this.trx.set(owner, this.trxOf(owner) - burnSun);
    this.usdt.set(owner, this.usdtOf(owner) - amount);
    this.usdt.set(to, this.usdtOf(to) + amount);

    return {
      ...base,
      fee: Number(burnSun),
      receipt: {
        result: 'SUCCESS',
        energy_usage: Math.min(ownEnergy, energy),
        energy_usage_total: energy,
        energy_fee: Number(burnSun),
        net_usage: 345,
      },
      log: [this.transferLog(owner, to, amount)],
    };
  }

  private build(type: string, value: Json, feeLimit?: number): Json {
    const transaction = {
      visible: true,
      txID: '',
      raw_data_hex: '',
      raw_data: {
        contract: [
          {
            type,
            parameter: {
              value,
              type_url: `type.googleapis.com/protocol.${type}`,
            },
          },
        ],
        ref_block_bytes: '1a2b',
        ref_block_hash: randomBytes(8).toString('hex'),
        expiration: Date.now() + 60_000,
        timestamp: Date.now(),
        ...(feeLimit === undefined ? {} : { fee_limit: feeLimit }),
      },
    };
    const protobuf = utils.transaction.txJsonToPb(transaction as never);
    transaction.raw_data_hex = utils.transaction.txPbToRawDataHex(protobuf);
    transaction.txID = utils.transaction
      .txPbToTxID(protobuf)
      .replace(/^0x/, '');

    return transaction;
  }

  private transferData(parameter: string): string {
    return `a9059cbb${parameter}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Json)
      : {};
    const path = (request.url ?? '').replace(/^\//, '');
    this.requests.push({
      path,
      apiKey: request.headers['tron-pro-api-key'] as string | undefined,
    });
    const reply = (value: unknown) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };

    switch (path) {
      case 'walletsolidity/getnowblock':
        return reply({ block_header: { raw_data: { number: this.head } } });
      case 'walletsolidity/getblockbynum': {
        const num = Number(body.num);
        const block = this.blocks.get(num);

        if (num > this.head) return reply({});

        return reply({
          block_header: { raw_data: { number: num } },
          transactions: (block ?? []).map((stored) => ({
            txID: stored.transaction.txID,
          })),
        });
      }
      case 'walletsolidity/gettransactioninfobyblocknum': {
        const num = Number(body.num);
        const infos = (this.blocks.get(num) ?? []).map((stored) => stored.info);

        if (this.dropInfosOfBlock === num) return reply(infos.slice(1));

        return reply(infos);
      }
      case 'walletsolidity/gettransactioninfobyid':
        return reply(this.byId.get(String(body.value))?.info ?? {});
      case 'wallet/gettransactionbyid': {
        const id = String(body.value);
        return reply(
          this.pending.get(id) ?? this.byId.get(id)?.transaction ?? {},
        );
      }
      case 'wallet/getchainparameters':
        return reply({
          chainParameter: [
            { key: 'getEnergyFee', value: ENERGY_FEE_SUN },
            { key: 'getTransactionFee', value: BANDWIDTH_FEE_SUN },
            { key: 'getCreateNewAccountFeeInSystemContract', value: 1_000_000 },
          ],
        });
      case 'wallet/getaccountresource':
        return reply({
          EnergyLimit: this.ownEnergy.get(String(body.address)) ?? 0,
          EnergyUsed: 0,
          freeNetLimit: 600,
          freeNetUsed: 0,
          TotalEnergyLimit: TOTAL_ENERGY_LIMIT,
          TotalEnergyWeight: TOTAL_ENERGY_WEIGHT,
        });
      case 'wallet/getaccount': {
        const address = String(body.address);
        return reply(
          this.activated.has(address)
            ? { address, balance: Number(this.trxOf(address)) }
            : {},
        );
      }
      case 'wallet/getcandelegatedmaxsize':
        return reply({
          max_size: Number(
            this.delegatableSun.get(String(body.owner_address)) ?? 0n,
          ),
        });
      case 'wallet/triggerconstantcontract': {
        if (body.function_selector === 'balanceOf(address)') {
          const address = TronWeb.address.fromHex(
            `41${String(body.parameter).slice(24)}`,
          );
          return reply({
            constant_result: [pad64(this.usdtOf(address).toString(16))],
          });
        }

        const to = TronWeb.address.fromHex(
          `41${String(body.parameter).slice(24, 64)}`,
        );
        return reply({ energy_used: this.usdtOf(to) > 0n ? 65_000 : 130_000 });
      }
      case 'wallet/triggersmartcontract': {
        const tamper = this.nextBuildTamper;
        this.nextBuildTamper = null;
        let parameter = String(body.parameter);

        if (tamper === 'recipient') {
          parameter =
            pad64(hex40('TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK')) +
            parameter.slice(64);
        }

        const value = {
          owner_address: body.owner_address,
          contract_address: body.contract_address,
          data: this.transferData(parameter),
        };
        const transaction = this.build(
          'TriggerSmartContract',
          value,
          Number(body.fee_limit),
        );

        if (tamper === 'hex') {
          const evil = this.build(
            'TriggerSmartContract',
            {
              ...value,
              data: this.transferData(
                pad64(hex40('TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK')) +
                  parameter.slice(64),
              ),
            },
            Number(body.fee_limit),
          );
          return reply({
            result: { result: true },
            transaction: {
              ...transaction,
              raw_data_hex: evil.raw_data_hex,
              txID: evil.txID,
            },
          });
        }

        return reply({ result: { result: true }, transaction });
      }
      case 'wallet/createtransaction':
        return reply(
          this.build('TransferContract', {
            owner_address: body.owner_address,
            to_address: body.to_address,
            amount: body.amount,
          }),
        );
      case 'wallet/delegateresource':
        return reply(
          this.build('DelegateResourceContract', {
            owner_address: body.owner_address,
            receiver_address: body.receiver_address,
            balance: body.balance,
            resource: 'ENERGY',
          }),
        );
      case 'wallet/undelegateresource':
        return reply(
          this.build('UnDelegateResourceContract', {
            owner_address: body.owner_address,
            receiver_address: body.receiver_address,
            balance: body.balance,
            resource: 'ENERGY',
          }),
        );
      case 'wallet/broadcasttransaction': {
        if (this.failBroadcasts) {
          response.writeHead(502);
          response.end();
          return;
        }

        const transaction = body as Json & {
          txID: string;
          signature?: string[];
        };
        const [contract] = (
          transaction.raw_data as { contract: { parameter: { value: Json } }[] }
        ).contract;
        const signer = TronWeb.address.fromHex(
          utils.crypto
            .ecRecover(transaction.txID, transaction.signature?.[0] ?? '')
            .toString()
            .toLowerCase(),
        );

        if (
          !utils.transaction.txCheck(transaction as never) ||
          signer !== contract.parameter.value.owner_address
        ) {
          return reply({ result: false, code: 'SIGERROR' });
        }

        this.pending.set(transaction.txID, transaction);
        this.broadcasts.push(transaction);
        return reply({ result: true, txid: transaction.txID });
      }
      default:
        response.writeHead(404);
        response.end();
    }
  }
}

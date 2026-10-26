import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { formatCrypto } from '../../common/utils/format-crypto';
import { TronAddress } from '../entities/tron-address.entity';
import { TronScanCursor } from '../entities/tron-scan-cursor.entity';
import { AddressPurpose } from '../types/address-purpose.enum';
import { IncomingTransferHandler } from '../types/incoming-transfer-handler';
import { TronTransactionInfo } from '../types/tron-transaction-info';
import { TronUnavailableError } from '../types/tron-unavailable.error';
import { UsdtTransferEvent } from '../types/usdt-transfer-event';
import { isSuccessfulTransaction } from '../utils/is-successful-transaction';
import { parseUsdtTransfers } from '../utils/parse-usdt-transfers';
import { TronNodeClient } from './tron-node.client';

@Injectable()
export class UsdtTransferScanner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsdtTransferScanner.name);
  private readonly handlers = new Map<
    AddressPurpose,
    IncomingTransferHandler
  >();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly node: TronNodeClient,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  register(purpose: AddressPurpose, handler: IncomingTransferHandler): void {
    this.handlers.set(purpose, handler);
  }

  onModuleInit(): void {
    const seconds = this.config.get<number>('TRON_SCAN_INTERVAL_SECONDS', 3);
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      return await this.run();
    } catch (error) {
      this.logger.error(`Scan failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  async run(): Promise<number> {
    const solidified = await this.node.getSolidifiedBlockNumber();
    let lastBlock = await this.ensureCursor(solidified);
    const lag = solidified - lastBlock;
    const maxLag = this.config.get<number>('TRON_SCAN_MAX_LAG_BLOCKS', 200);

    if (lag > maxLag) {
      this.logger.warn(`Scanner is ${lag} blocks behind the solidified head`);
    }

    const batch = this.config.get<number>('TRON_SCAN_BATCH_BLOCKS', 100);
    let scanned = 0;

    while (scanned < batch && lastBlock < solidified) {
      const block = lastBlock + 1;
      const [infos, expected] = await Promise.all([
        this.node.getSolidifiedTransactionInfos(block),
        this.node.getSolidifiedBlockTransactionCount(block),
      ]);

      if (infos.length !== expected) {
        throw new TronUnavailableError(
          `Block ${block} has ${expected} transactions but ${infos.length} infos`,
        );
      }

      const advanced = await this.dataSource.transaction((manager) =>
        this.processBlock(manager, block, infos),
      );

      if (!advanced) break;

      lastBlock = block;
      scanned += 1;
    }

    return scanned;
  }

  private async ensureCursor(solidified: number): Promise<number> {
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(TronScanCursor)
      .values({
        singleton: true,
        network: this.config.getOrThrow<string>('TRON_NETWORK'),
        lastBlock: String(solidified),
      })
      .orIgnore()
      .execute();
    const cursor = await this.dataSource
      .getRepository(TronScanCursor)
      .findOneOrFail({ where: { singleton: true } });
    const network = this.config.getOrThrow<string>('TRON_NETWORK');

    if (cursor.network !== network) {
      throw new Error(
        `The scan cursor belongs to ${cursor.network}, not ${network}; refusing to scan`,
      );
    }

    return Number(cursor.lastBlock);
  }

  private async processBlock(
    manager: EntityManager,
    block: number,
    infos: TronTransactionInfo[],
  ): Promise<boolean> {
    const cursor = await manager
      .getRepository(TronScanCursor)
      .createQueryBuilder('cursor')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where('cursor.singleton = true')
      .getOne();

    if (!cursor || Number(cursor.lastBlock) !== block - 1) return false;

    const contract = this.config.getOrThrow<string>('TRON_USDT_CONTRACT');
    const events = infos
      .filter(isSuccessfulTransaction)
      .flatMap((info) =>
        parseUsdtTransfers({ ...info, blockNumber: block }, contract),
      );

    if (events.length > 0) await this.deliver(manager, events);

    cursor.lastBlock = String(block);
    await manager.save(cursor);

    return true;
  }

  private async deliver(
    manager: EntityManager,
    events: UsdtTransferEvent[],
  ): Promise<void> {
    const addresses = await manager.find(TronAddress, {
      where: { address: In([...new Set(events.map((event) => event.to))]) },
    });
    const byAddress = new Map(addresses.map((row) => [row.address, row]));

    for (const event of events) {
      const address = byAddress.get(event.to);

      if (!address) continue;

      if (address.purpose === AddressPurpose.Deposit) {
        await manager
          .createQueryBuilder()
          .update(TronAddress)
          .set({
            unsweptAmount: () => '"unsweptAmount" + :amount',
            lastIncomingAt: event.blockTime,
          })
          .where('id = :id', { id: address.id })
          .setParameter('amount', formatCrypto(event.amount))
          .execute();
      }

      const handler = this.handlers.get(address.purpose);

      if (handler) {
        await handler(manager, event, address);
      } else {
        this.logger.log(
          `USDT ${event.txHash}:${event.logIndex} reached the ${address.purpose} wallet`,
        );
      }
    }
  }
}

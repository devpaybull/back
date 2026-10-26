import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Like } from 'typeorm';
import { formatCrypto } from '../../common/utils/format-crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { TronAddress } from '../entities/tron-address.entity';
import { TronOutgoingTransfer } from '../entities/tron-outgoing-transfer.entity';
import { AddressPurpose } from '../types/address-purpose.enum';
import { OutgoingTransferKind } from '../types/outgoing-transfer-kind.enum';
import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';
import { fromSun } from '../utils/from-sun';
import { isFinalOutgoingStatus } from '../utils/is-final-outgoing-status';
import { EnergyManager } from './energy-manager.service';
import { TronConfirmationTracker } from './tron-confirmation-tracker.service';
import { TronKeyring } from './tron-keyring.service';
import { TronNodeClient } from './tron-node.client';
import { TronSender } from './tron-sender.service';

const SWEEP_KEY_PREFIX = 'sweep';
const ACTIVATION_AMOUNT = '0.000001';
const IN_FLIGHT: OutgoingTransferStatus[] = [
  OutgoingTransferStatus.Building,
  OutgoingTransferStatus.Signed,
  OutgoingTransferStatus.Broadcast,
];

@Injectable()
export class SweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly node: TronNodeClient,
    private readonly keyring: TronKeyring,
    private readonly sender: TronSender,
    private readonly energy: EnergyManager,
    tracker: TronConfirmationTracker,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    tracker.register(SWEEP_KEY_PREFIX, (manager, transfer) =>
      this.onStepFinal(manager, transfer),
    );
  }

  onModuleInit(): void {
    const seconds = this.config.get<number>('SWEEP_INTERVAL_SECONDS', 300);
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      return await this.run(now);
    } catch (error) {
      this.logger.error(`Sweep run failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  async run(now: Date): Promise<number> {
    const candidates = await this.candidates(now);
    let stepped = 0;

    for (const address of candidates) {
      try {
        if (await this.step(address)) stepped += 1;
      } catch (error) {
        this.logger.warn(
          `Sweep of ${address.address} postponed: ${(error as Error).message}`,
        );
      }
    }

    return stepped;
  }

  private candidates(now: Date): Promise<TronAddress[]> {
    const idleSince = new Date(
      now.getTime() -
        this.config.get<number>('SWEEP_MAX_IDLE_HOURS', 24) * 3_600_000,
    );

    return this.dataSource
      .getRepository(TronAddress)
      .createQueryBuilder('address')
      .where('address.purpose = :purpose', { purpose: AddressPurpose.Deposit })
      .andWhere(
        new Brackets((where) =>
          where
            .where('address.unsweptAmount >= :minimum', {
              minimum: formatCrypto(
                toCrypto(this.config.getOrThrow<string>('SWEEP_MIN_USDT')),
              ),
            })
            .orWhere(
              'address.unsweptAmount > 0 AND address.lastIncomingAt <= :idleSince',
              { idleSince },
            )
            .orWhere('address.sweepDelegatedSun IS NOT NULL'),
        ),
      )
      .orderBy('address.unsweptAmount', 'DESC')
      .addOrderBy('address.id', 'ASC')
      .take(this.config.get<number>('SWEEP_BATCH_SIZE', 20))
      .getMany();
  }

  private async step(address: TronAddress): Promise<boolean> {
    const inFlight = await this.dataSource
      .getRepository(TronOutgoingTransfer)
      .count({
        where: {
          idempotencyKey: Like(`${SWEEP_KEY_PREFIX}:${address.id}:%`),
          status: In(IN_FLIGHT),
        },
      });

    if (inFlight > 0) return false;

    const hot = await this.keyring.hotAddress();
    const key = (step: string) =>
      `${SWEEP_KEY_PREFIX}:${address.id}:${address.sweepNonce}:${step}`;
    const balanceSun = await this.node.getUsdtBalanceSun(address.address);

    if (BigInt(balanceSun) === 0n) {
      if (address.sweepDelegatedSun) {
        return this.sent(address, () =>
          this.sender.undelegateEnergy({
            idempotencyKey: key('undelegate'),
            receiver: address.address,
            balanceSun: address.sweepDelegatedSun!,
          }),
        );
      }

      await this.dataSource
        .getRepository(TronAddress)
        .update(address.id, { unsweptAmount: toCrypto(0) });
      return false;
    }

    if (!address.activatedAt) {
      if (await this.node.isActivated(address.address)) {
        await this.dataSource
          .getRepository(TronAddress)
          .update(address.id, { activatedAt: new Date() });
      } else {
        return this.sent(address, () =>
          this.sender.sendTrx({
            idempotencyKey: key('activate'),
            from: { kind: 'hot' },
            to: address.address,
            amount: toCrypto(ACTIVATION_AMOUNT),
          }),
        );
      }
    }

    const amount = fromSun(balanceSun);
    const cost = await this.energy.estimateUsdtTransfer(
      address.address,
      hot,
      amount,
    );
    const plan = await this.energy.planForSweep(address.address, cost);

    switch (plan.action) {
      case 'wait':
        return false;
      case 'delegate': {
        const delegated = await this.sent(address, () =>
          this.sender.delegateEnergy({
            idempotencyKey: key('delegate'),
            receiver: address.address,
            balanceSun: plan.balanceSun,
          }),
        );

        if (delegated) {
          await this.dataSource
            .getRepository(TronAddress)
            .update(address.id, { sweepDelegatedSun: plan.balanceSun });
        }

        return delegated;
      }
      case 'burn':
        return this.sent(address, () =>
          this.sender.sendTrx({
            idempotencyKey: key('fund'),
            from: { kind: 'hot' },
            to: address.address,
            amount: fromSun(plan.burnSun),
          }),
        );
      case 'ready':
        return this.sent(address, () =>
          this.sender.sendUsdt({
            idempotencyKey: key('usdt'),
            from: {
              kind: 'deposit',
              derivationIndex: address.derivationIndex!,
            },
            to: hot,
            amount,
          }),
        );
    }
  }

  private async sent(
    address: TronAddress,
    send: () => Promise<TronOutgoingTransfer>,
  ): Promise<boolean> {
    let transfer: TronOutgoingTransfer;

    try {
      transfer = await send();
    } catch (error) {
      await this.bumpNonce(address);
      throw error;
    }

    if (!transfer.txHash && isFinalOutgoingStatus(transfer.status)) {
      await this.bumpNonce(address);
      return false;
    }

    return true;
  }

  private async bumpNonce(address: TronAddress): Promise<void> {
    await this.dataSource
      .getRepository(TronAddress)
      .increment({ id: address.id }, 'sweepNonce', 1);
  }

  private async onStepFinal(
    manager: EntityManager,
    transfer: TronOutgoingTransfer,
  ): Promise<void> {
    const [, id, , step] = transfer.idempotencyKey.split(':');
    const address = await manager.findOne(TronAddress, {
      where: { id: Number(id) },
      lock: { mode: 'pessimistic_write' },
    });

    if (!address) return;

    const confirmed = transfer.status === OutgoingTransferStatus.Confirmed;
    address.sweepNonce += 1;

    if (confirmed && step === 'activate') address.activatedAt = new Date();

    if (step === 'delegate' && !confirmed) address.sweepDelegatedSun = null;

    if (confirmed && step === 'undelegate') address.sweepDelegatedSun = null;

    if (confirmed && transfer.kind === OutgoingTransferKind.Usdt) {
      const swept = fromSun(transfer.amountSun);
      const remaining = roundCrypto(address.unsweptAmount.minus(swept));
      address.unsweptAmount = remaining.isNegative() ? toCrypto(0) : remaining;
      address.lastSweptAt = new Date();
    }

    await manager.save(address);

    if (!confirmed) {
      this.logger.warn(
        `Sweep step ${transfer.idempotencyKey} ended ${transfer.status}: ${transfer.failureReason ?? ''}`,
      );
    }
  }
}

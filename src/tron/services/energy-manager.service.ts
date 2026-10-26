import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Crypto } from '../../common/types/crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { EnergyPlan } from '../types/energy-plan';
import { TransferCost } from '../types/transfer-cost';
import { TRX_RATE_SOURCE, TrxRateSource } from '../types/trx-rate-source';
import { fromSun } from '../utils/from-sun';
import { SUN_PER_UNIT } from '../utils/sun-per-unit';
import { toSun } from '../utils/to-sun';
import { TronKeyring } from './tron-keyring.service';
import { TronNodeClient } from './tron-node.client';

const USDT_TRANSFER_BANDWIDTH = 350;

@Injectable()
export class EnergyManager {
  constructor(
    private readonly config: ConfigService,
    private readonly node: TronNodeClient,
    private readonly keyring: TronKeyring,
    @Inject(TRX_RATE_SOURCE) private readonly trxRate: TrxRateSource,
  ) {}

  async estimateUsdtTransfer(
    from: string,
    to: string,
    amount: Crypto,
  ): Promise<TransferCost> {
    const [energy, parameters] = await Promise.all([
      this.node.estimateUsdtTransferEnergy(from, to, toSun(amount)),
      this.node.getChainParameters(),
    ]);
    const burnSun =
      BigInt(energy) * BigInt(parameters.energyFeeSun) +
      BigInt(USDT_TRANSFER_BANDWIDTH) * BigInt(parameters.bandwidthFeeSun);

    return {
      energy,
      bandwidth: USDT_TRANSFER_BANDWIDTH,
      burnSun: burnSun.toString(),
    };
  }

  async quoteUsdtTransferFee(
    from: string,
    to: string,
    amount: Crypto,
  ): Promise<{ trx: Crypto; usdt: Crypto }> {
    const cost = await this.estimateUsdtTransfer(from, to, amount);
    const trx = fromSun(cost.burnSun);
    const rate = await this.trxRate.getUsdtPerTrx();

    return {
      trx,
      usdt: roundCrypto(toDecimal(trx).times(rate)),
    };
  }

  async planForSweep(address: string, cost: TransferCost): Promise<EnergyPlan> {
    const resources = await this.node.getAccountResources(address);
    const ownEnergy = resources.energyLimit - resources.energyUsed;
    const freeBandwidth =
      resources.freeBandwidthLimit - resources.freeBandwidthUsed;
    const bandwidthBurnSun =
      freeBandwidth >= cost.bandwidth
        ? 0n
        : BigInt(cost.bandwidth) *
          BigInt((await this.node.getChainParameters()).bandwidthFeeSun);

    if (ownEnergy >= cost.energy && bandwidthBurnSun === 0n) {
      return { action: 'ready' };
    }

    if (ownEnergy < cost.energy) {
      const energyAddress = await this.keyring.energyAddress();
      const [energyResources, delegatable] = await Promise.all([
        this.node.getAccountResources(energyAddress),
        this.node.getDelegatableEnergySun(energyAddress),
      ]);
      const balanceSun = this.delegationFor(
        cost.energy - ownEnergy,
        energyResources.totalEnergyLimit,
        energyResources.totalEnergyWeight,
      );

      if (balanceSun !== null && BigInt(delegatable) >= BigInt(balanceSun)) {
        if (bandwidthBurnSun === 0n) return { action: 'delegate', balanceSun };

        const bandwidth = await this.burnPlan(bandwidthBurnSun, address);

        return bandwidth.action === 'ready'
          ? { action: 'delegate', balanceSun }
          : bandwidth;
      }
    }

    if (!this.config.get<boolean>('SWEEP_BURN_WHEN_NO_ENERGY')) {
      return { action: 'wait' };
    }

    const energyBurnSun =
      ownEnergy >= cost.energy
        ? 0n
        : BigInt(cost.energy - Math.max(0, ownEnergy)) *
          BigInt((await this.node.getChainParameters()).energyFeeSun);

    return this.burnPlan(energyBurnSun + bandwidthBurnSun, address);
  }

  async canPayFrom(address: string, cost: TransferCost): Promise<boolean> {
    const resources = await this.node.getAccountResources(address);

    if (resources.energyLimit - resources.energyUsed >= cost.energy)
      return true;

    const balance = BigInt(await this.node.getTrxBalanceSun(address));

    return balance >= BigInt(cost.burnSun);
  }

  maxBurnSun(): bigint {
    return BigInt(
      toSun(
        toCrypto(this.config.getOrThrow<string>('TRON_MAX_TRX_BURN_PER_TX')),
      ),
    );
  }

  private async burnPlan(
    burnSun: bigint,
    address: string,
  ): Promise<EnergyPlan> {
    if (burnSun > this.maxBurnSun()) return { action: 'wait' };

    const balance = BigInt(await this.node.getTrxBalanceSun(address));

    return balance >= burnSun
      ? { action: 'ready' }
      : { action: 'burn', burnSun: (burnSun - balance).toString() };
  }

  private delegationFor(
    energy: number,
    totalEnergyLimit: number,
    totalEnergyWeight: number,
  ): string | null {
    if (totalEnergyLimit <= 0 || totalEnergyWeight <= 0) return null;

    const trx = Math.max(
      1,
      Math.ceil((energy * totalEnergyWeight) / totalEnergyLimit),
    );

    return (BigInt(trx) * BigInt(SUN_PER_UNIT)).toString();
  }
}

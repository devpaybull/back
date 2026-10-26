import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { TronWeb, utils } from 'tronweb';
import { DataSource, EntityManager } from 'typeorm';
import { TronAddress } from '../entities/tron-address.entity';
import { AddressPurpose } from '../types/address-purpose.enum';
import { addressFromExtendedKey } from '../utils/address-from-extended-key';
import { DEPOSIT_ACCOUNT_PATH } from '../utils/deposit-account-path';
import { VaultTransitClient } from './vault-transit.client';

interface KeyringState {
  depositExtendedKey: string;
  hotAddress: string;
  energyAddress: string;
}

@Injectable()
export class TronKeyring {
  private state: Promise<KeyringState> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly vault: VaultTransitClient,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async hotAddress(): Promise<string> {
    return (await this.ready()).hotAddress;
  }

  async energyAddress(): Promise<string> {
    return (await this.ready()).energyAddress;
  }

  async depositAddressAt(derivationIndex: number): Promise<string> {
    return addressFromExtendedKey(
      (await this.ready()).depositExtendedKey,
      derivationIndex,
    );
  }

  findAddress(address: string): Promise<TronAddress | null> {
    return this.dataSource
      .getRepository(TronAddress)
      .findOne({ where: { address } });
  }

  async issueDepositAddress(manager: EntityManager): Promise<TronAddress> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'tron_addresses:deposit',
    ]);
    const last = await manager.findOne(TronAddress, {
      where: { purpose: AddressPurpose.Deposit },
      order: { derivationIndex: 'DESC' },
    });
    const derivationIndex = (last?.derivationIndex ?? -1) + 1;
    const address = await this.depositAddressAt(derivationIndex);

    return manager.save(
      manager.create(TronAddress, {
        address,
        derivationIndex,
        purpose: AddressPurpose.Deposit,
      }),
    );
  }

  private ready(): Promise<KeyringState> {
    if (!this.state) {
      this.state = this.load().catch((error: unknown) => {
        this.state = null;
        throw error;
      });
    }

    return this.state;
  }

  private async load(): Promise<KeyringState> {
    const seed = await this.vault.decrypt(
      this.config.getOrThrow<string>('TRON_DEPOSIT_SEED_CIPHERTEXT'),
    );
    let depositExtendedKey: string;

    try {
      depositExtendedKey = utils.ethersUtils.ethersHDNodeWallet
        .fromPhrase(
          seed.toString('utf8').trim(),
          undefined,
          DEPOSIT_ACCOUNT_PATH,
        )
        .neuter().extendedKey;
    } finally {
      seed.fill(0);
    }

    const state: KeyringState = {
      depositExtendedKey,
      hotAddress: await this.addressOfKey('TRON_HOT_KEY_CIPHERTEXT'),
      energyAddress: await this.addressOfKey('TRON_ENERGY_KEY_CIPHERTEXT'),
    };
    await this.registerWallet(state.hotAddress, AddressPurpose.Hot);
    await this.registerWallet(state.energyAddress, AddressPurpose.Energy);

    return state;
  }

  private async addressOfKey(variable: string): Promise<string> {
    const key = await this.vault.decrypt(
      this.config.getOrThrow<string>(variable),
    );

    try {
      const address = TronWeb.address.fromPrivateKey(
        key.toString('utf8').trim().replace(/^0x/, ''),
      );

      if (!address) throw new Error(`${variable} is not a private key`);

      return address;
    } finally {
      key.fill(0);
    }
  }

  private async registerWallet(
    address: string,
    purpose: AddressPurpose,
  ): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(TronAddress)
      .values({ address, purpose, derivationIndex: null })
      .orIgnore()
      .execute();
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { canonicalIp } from '../../common/utils/canonical-ip';
import { MerchantIpAddress } from '../entities/merchant-ip-address.entity';
import { MerchantSettings } from '../entities/merchant-settings.entity';
import { Merchant } from '../entities/merchant.entity';

const MERCHANT_IP_ADDRESSES_MAX = 50;

const normalizeIp = (raw: string): string => {
  if (raw.includes('%')) {
    throw new BadRequestException('An IP address with a zone is not accepted');
  }

  const ip = canonicalIp(raw);

  if (ip === null) {
    throw new BadRequestException(`${raw} is not an IP address`);
  }

  return ip;
};

@Injectable()
export class MerchantIpAddressesService {
  constructor(
    @InjectRepository(MerchantIpAddress)
    private readonly addresses: Repository<MerchantIpAddress>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  list(merchantId: string): Promise<MerchantIpAddress[]> {
    return this.addresses.find({
      where: { merchantId },
      order: { id: 'ASC' },
    });
  }

  async admits(
    merchantId: string,
    rawIp: string | undefined,
  ): Promise<boolean> {
    const settings = await this.dataSource.manager.findOne(MerchantSettings, {
      where: { merchantId },
    });

    if (!settings?.ipCheckEnabled) return true;

    let ip: string;

    try {
      ip = normalizeIp(rawIp ?? '');
    } catch {
      return false;
    }

    return (await this.addresses.count({ where: { merchantId, ip } })) > 0;
  }

  async add(
    merchantId: string,
    raw: string,
    actorUserId: string,
  ): Promise<MerchantIpAddress> {
    const ip = normalizeIp(raw);

    return this.dataSource.transaction(async (manager) => {
      await this.lockMerchant(manager, merchantId);

      const existing = await manager.find(MerchantIpAddress, {
        where: { merchantId },
      });

      if (existing.length >= MERCHANT_IP_ADDRESSES_MAX) {
        throw new BadRequestException(
          `A merchant whitelists at most ${MERCHANT_IP_ADDRESSES_MAX} addresses`,
        );
      }

      if (existing.some((row) => row.ip === ip)) {
        throw new ConflictException('The address is already whitelisted');
      }

      const saved = await manager.save(
        manager.create(MerchantIpAddress, {
          merchantId,
          ip,
          createdByUserId: actorUserId,
        }),
      );

      await this.audit.record(
        {
          actorUserId,
          action: 'merchant.ip_added',
          metadata: { merchantId, ipAddressId: saved.id, ip },
        },
        manager,
      );

      return saved;
    });
  }

  async remove(
    merchantId: string,
    ipAddressId: number,
    actorUserId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockMerchant(manager, merchantId);

      const row = await manager.findOne(MerchantIpAddress, {
        where: { id: ipAddressId, merchantId },
      });

      if (!row) throw new NotFoundException('IP address not found');

      const settings = await manager.findOne(MerchantSettings, {
        where: { merchantId },
      });

      if (settings?.ipCheckEnabled) {
        const remaining = await manager.count(MerchantIpAddress, {
          where: { merchantId },
        });

        if (remaining <= 1) {
          throw new BadRequestException(
            'The last whitelisted address cannot be removed while IP checking is on',
          );
        }
      }

      await manager.delete(MerchantIpAddress, { id: row.id });

      await this.audit.record(
        {
          actorUserId,
          action: 'merchant.ip_removed',
          metadata: {
            merchantId,
            ipAddressId: row.id,
            ip: row.ip,
          },
        },
        manager,
      );
    });
  }

  private async lockMerchant(
    manager: EntityManager,
    merchantId: string,
  ): Promise<void> {
    const merchant = await manager.findOne(Merchant, {
      where: { id: merchantId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!merchant) throw new NotFoundException('Merchant not found');
  }
}

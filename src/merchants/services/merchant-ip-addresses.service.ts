import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { isIP } from 'node:net';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { maskIp } from '../../common/utils/mask-ip';
import { MerchantIpAddress } from '../entities/merchant-ip-address.entity';
import { MerchantSettings } from '../entities/merchant-settings.entity';
import { Merchant } from '../entities/merchant.entity';

const MERCHANT_IP_ADDRESSES_MAX = 50;

const IPV6_GROUPS = 8;
const IPV4_MAPPED_PREFIX = ['0', '0', '0', '0', '0', 'ffff'];
const DOTTED_TAIL = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

const hexPair = (high: string, low: string): string =>
  ((Number(high) << 8) | Number(low)).toString(16);

const normalizeIpv6 = (value: string): string => {
  const dotted = value.match(DOTTED_TAIL);
  const text = dotted
    ? `${value.slice(0, -dotted[0].length)}${hexPair(dotted[1], dotted[2])}:${hexPair(dotted[3], dotted[4])}`
    : value;
  const [head, tail] = text.includes('::') ? text.split('::') : [text];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(IPV6_GROUPS - left.length - right.length).fill('0'),
          ...right,
        ];

  const normalized = groups.map((group) => parseInt(group, 16).toString(16));
  const mapped = IPV4_MAPPED_PREFIX.every(
    (group, index) => normalized[index] === group,
  );

  if (!mapped) return normalized.join(':');

  const [high, low] = normalized
    .slice(IPV4_MAPPED_PREFIX.length)
    .map((group) => parseInt(group, 16));

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};

const normalizeIp = (raw: string): string => {
  const value = raw.trim().toLowerCase();

  if (value.includes('%')) {
    throw new BadRequestException('An IP address with a zone is not accepted');
  }

  switch (isIP(value)) {
    case 4:
      return value;
    case 6:
      return normalizeIpv6(value);
    default:
      throw new BadRequestException(`${raw} is not an IP address`);
  }
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
          metadata: { merchantId, ipAddressId: saved.id, ip: maskIp(ip) },
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
            ip: maskIp(row.ip),
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

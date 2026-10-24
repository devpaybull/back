import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { sortDirection } from '../../common/utils/sort-direction';
import { toPage, Page } from '../../common/types/page';
import { LoginFootprint } from '../entities/login-footprint.entity';
import { LoginContext } from '../types/login-context';
import { LoginFootprintListQuery } from '../types/login-footprint-list-query';
import { LoginFootprintRecord } from '../types/login-footprint-record';
import { normalizeIp } from '../utils/normalize-ip';
import { GeoIpService } from './geo-ip.service';

const MAX_FINGERPRINT_LENGTH = 128;
const MAX_USER_AGENT_LENGTH = 512;
const CONFLICT_PATHS = ['userId', 'ip', 'fingerprint', 'userAgent'];

interface CombinationCount {
  ip: string;
  fingerprint: string;
  userAgent: string;
  accounts: string;
}

const combinationKey = (
  ip: string,
  fingerprint: string,
  userAgent: string,
): string => JSON.stringify([ip, fingerprint, userAgent]);

@Injectable()
export class LoginFootprintService {
  private readonly logger = new Logger(LoginFootprintService.name);

  constructor(
    @InjectRepository(LoginFootprint)
    private readonly footprints: Repository<LoginFootprint>,
    private readonly geoIp: GeoIpService,
  ) {}

  async record(userId: string, context: LoginContext): Promise<void> {
    try {
      if (!context.ip) return;

      const ip = normalizeIp(context.ip);

      await this.footprints.upsert(
        {
          userId,
          ip,
          country: this.geoIp.countryOf(ip),
          fingerprint: (context.fingerprint ?? '').slice(
            0,
            MAX_FINGERPRINT_LENGTH,
          ),
          userAgent: (context.userAgent ?? '').slice(0, MAX_USER_AGENT_LENGTH),
          lastSeenAt: new Date(),
        },
        CONFLICT_PATHS,
      );
    } catch (error) {
      this.logger.error(
        `Login footprint of ${userId} was not recorded: ${String(error)}`,
      );
    }
  }

  async list(
    userId: string,
    query: LoginFootprintListQuery,
  ): Promise<Page<LoginFootprintRecord>> {
    const direction = sortDirection(query.sortOrder);
    const [rows, total] = await this.footprints.findAndCount({
      where: { userId },
      order: { lastSeenAt: direction, id: direction },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const accounts = await this.countAccounts(rows);

    return toPage(
      [
        rows.map((row) => ({
          id: row.id,
          ip: row.ip,
          country: row.country,
          fingerprint: row.fingerprint || null,
          userAgent: row.userAgent || null,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          seenOnAccounts:
            accounts.get(
              combinationKey(row.ip, row.fingerprint, row.userAgent),
            ) ?? 1,
        })),
        total,
      ],
      query,
    );
  }

  private async countAccounts(
    rows: LoginFootprint[],
  ): Promise<Map<string, number>> {
    if (rows.length === 0) return new Map();

    const counts = await this.footprints
      .createQueryBuilder('footprint')
      .select('footprint.ip', 'ip')
      .addSelect('footprint.fingerprint', 'fingerprint')
      .addSelect('footprint.userAgent', 'userAgent')
      .addSelect('COUNT(DISTINCT footprint.userId)', 'accounts')
      .where(
        new Brackets((conditions) =>
          rows.forEach((row, index) =>
            conditions.orWhere(
              `(footprint.ip = :ip${index} AND footprint.fingerprint = :fingerprint${index} AND footprint.userAgent = :userAgent${index})`,
              {
                [`ip${index}`]: row.ip,
                [`fingerprint${index}`]: row.fingerprint,
                [`userAgent${index}`]: row.userAgent,
              },
            ),
          ),
        ),
      )
      .groupBy('footprint.ip')
      .addGroupBy('footprint.fingerprint')
      .addGroupBy('footprint.userAgent')
      .getRawMany<CombinationCount>();

    return new Map(
      counts.map((count) => [
        combinationKey(count.ip, count.fingerprint, count.userAgent),
        Number(count.accounts),
      ]),
    );
  }
}

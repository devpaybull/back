import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { Role } from '../../common/enums/role.enum';
import { TraderLead } from '../entities/trader-lead.entity';
import { User } from '../entities/user.entity';
import { TeamMember } from '../types/team-member';
import { UserDirectoryService } from './user-directory.service';

const UNIQUE_VIOLATION = '23505';
const LINK_EXISTS = 'This lead already leads the trader';

@Injectable()
export class UserTeamService {
  constructor(
    @InjectRepository(TraderLead)
    private readonly links: Repository<TraderLead>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly directory: UserDirectoryService,
    private readonly audit: AuditService,
  ) {}

  async addLead(
    traderUserId: string,
    leadUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const trader = await this.directory.findById(traderUserId);

    if (!trader) throw new NotFoundException('User not found');

    if (trader.role !== Role.Trader) {
      throw new BadRequestException('Only a trader can have a lead');
    }

    const lead = await this.directory.findById(leadUserId);

    if (!lead) throw new BadRequestException('Lead not found');

    if (lead.role !== Role.LeadTrader) {
      throw new BadRequestException('The lead must be a lead trader');
    }

    if (await this.links.findOne({ where: { traderUserId, leadUserId } })) {
      throw new ConflictException(LINK_EXISTS);
    }

    await this.dataSource
      .transaction(async (manager) => {
        await manager.save(
          manager.create(TraderLead, { traderUserId, leadUserId }),
        );
        await this.audit.record(
          {
            actorUserId,
            targetUserId: traderUserId,
            action: 'user.lead_added',
            metadata: { leadUserId },
          },
          manager,
        );
      })
      .catch((error: unknown) => {
        if (
          error instanceof QueryFailedError &&
          (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
        ) {
          throw new ConflictException(LINK_EXISTS);
        }

        throw error;
      });
  }

  async removeLead(
    traderUserId: string,
    leadUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const link = await this.links.findOne({
      where: { traderUserId, leadUserId },
    });

    if (!link)
      throw new NotFoundException('This lead does not lead the trader');

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(TraderLead, { id: link.id });
      await this.audit.record(
        {
          actorUserId,
          targetUserId: traderUserId,
          action: 'user.lead_removed',
          metadata: { leadUserId },
        },
        manager,
      );
    });
  }

  async leadsOf(traderUserIds: string[]): Promise<Map<string, TeamMember[]>> {
    if (traderUserIds.length === 0) return new Map();

    const links = await this.links.find({
      where: { traderUserId: In(traderUserIds) },
      relations: { lead: true },
      order: { id: 'ASC' },
    });

    return this.grouped(
      links,
      (link) => link.traderUserId,
      (link) => link.lead,
    );
  }

  async subordinatesOf(
    leadUserIds: string[],
  ): Promise<Map<string, TeamMember[]>> {
    if (leadUserIds.length === 0) return new Map();

    const links = await this.links.find({
      where: { leadUserId: In(leadUserIds) },
      relations: { trader: true },
      order: { id: 'ASC' },
    });

    return this.grouped(
      links,
      (link) => link.leadUserId,
      (link) => link.trader,
    );
  }

  private grouped(
    links: TraderLead[],
    ownerOf: (link: TraderLead) => string,
    memberOf: (link: TraderLead) => User,
  ): Map<string, TeamMember[]> {
    const byOwner = new Map<string, TeamMember[]>();

    for (const link of links) {
      const member = memberOf(link);
      const members = byOwner.get(ownerOf(link)) ?? [];

      members.push({
        id: member.id,
        login: member.email ?? member.telegramUsername,
      });
      byOwner.set(ownerOf(link), members);
    }

    return byOwner;
  }
}

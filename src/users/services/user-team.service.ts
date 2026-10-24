import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Role } from '../../common/enums/role.enum';
import { loginOf } from '../../common/utils/login-of';
import { CurrenciesService } from '../../currencies/currencies.service';
import { TraderLead } from '../entities/trader-lead.entity';
import { User } from '../entities/user.entity';
import { LeadAssignment } from '../types/lead-assignment';
import { TeamMember } from '../types/team-member';
import { UserDirectoryService } from './user-directory.service';

const UNIQUE_VIOLATION = '23505';
const LINK_EXISTS = 'This lead already leads the trader in this currency';

const assignmentKey = (assignment: {
  leadUserId: string;
  currencyId: number;
}): string => `${assignment.leadUserId}:${assignment.currencyId}`;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string }).code === UNIQUE_VIOLATION;

@Injectable()
export class UserTeamService {
  constructor(
    @InjectRepository(TraderLead)
    private readonly links: Repository<TraderLead>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly directory: UserDirectoryService,
    private readonly audit: AuditService,
    private readonly currencies: CurrenciesService,
  ) {}

  async addLead(
    traderUserId: string,
    assignment: LeadAssignment,
    actorUserId: string,
  ): Promise<void> {
    await this.assertAssignable(traderUserId, [assignment]);

    const { leadUserId, currencyId } = assignment;

    if (
      await this.links.findOne({
        where: { traderUserId, leadUserId, currencyId },
      })
    ) {
      throw new ConflictException(LINK_EXISTS);
    }

    await this.dataSource
      .transaction(async (manager) => {
        await manager.save(
          manager.create(TraderLead, {
            traderUserId,
            leadUserId,
            currencyId,
            payInPercent: assignment.payInPercent,
            payOutPercent: assignment.payOutPercent,
          }),
        );
        await this.audit.record(
          {
            actorUserId,
            targetUserId: traderUserId,
            action: 'user.lead_added',
            metadata: {
              leadUserId,
              currencyId,
              payInPercent: assignment.payInPercent,
              payOutPercent: assignment.payOutPercent,
            },
          },
          manager,
        );
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ConflictException(LINK_EXISTS);

        throw error;
      });
  }

  async replaceLeads(
    traderUserId: string,
    assignments: LeadAssignment[],
    actorUserId: string,
  ): Promise<TraderLead[]> {
    const keys = assignments.map(assignmentKey);

    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('A lead may appear only once per currency');
    }

    await this.assertAssignable(traderUserId, assignments);

    await this.dataSource
      .transaction(async (manager) => {
        const existing = await manager.find(TraderLead, {
          where: { traderUserId },
        });
        const existingByKey = new Map(
          existing.map((link) => [assignmentKey(link), link]),
        );
        const kept = new Set(keys);
        const dropped = existing
          .filter((link) => !kept.has(assignmentKey(link)))
          .map((link) => link.id);

        if (dropped.length) {
          await manager.delete(TraderLead, { id: In(dropped) });
        }

        const rows = assignments.map((assignment) => {
          const current = existingByKey.get(assignmentKey(assignment));
          const values = {
            traderUserId,
            leadUserId: assignment.leadUserId,
            currencyId: assignment.currencyId,
            payInPercent: assignment.payInPercent,
            payOutPercent: assignment.payOutPercent,
          };

          return current
            ? manager.merge(TraderLead, current, values)
            : manager.create(TraderLead, values);
        });

        if (rows.length) await manager.save(rows);

        await this.audit.record(
          {
            actorUserId,
            targetUserId: traderUserId,
            action: 'user.leads_replaced',
            metadata: {
              leads: assignments.map((assignment) => ({
                leadUserId: assignment.leadUserId,
                currencyId: assignment.currencyId,
                payInPercent: assignment.payInPercent,
                payOutPercent: assignment.payOutPercent,
              })),
            },
          },
          manager,
        );
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new ConflictException(LINK_EXISTS);

        throw error;
      });

    return this.assignmentsOf(traderUserId);
  }

  async removeLead(
    traderUserId: string,
    leadUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const links = await this.links.find({
      where: { traderUserId, leadUserId },
    });

    if (!links.length)
      throw new NotFoundException('This lead does not lead the trader');

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(TraderLead, {
        id: In(links.map((link) => link.id)),
      });
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

  assignmentsOf(traderUserId: string): Promise<TraderLead[]> {
    return this.links.find({
      where: { traderUserId },
      relations: { lead: true, currency: true },
      order: { id: 'ASC' },
    });
  }

  assignmentsLedBy(leadUserId: string): Promise<TraderLead[]> {
    return this.links.find({
      where: { leadUserId },
      relations: { trader: true, currency: true },
      order: { id: 'ASC' },
    });
  }

  findPair(traderUserId: string, leadUserId: string): Promise<TraderLead[]> {
    return this.links.find({
      where: { traderUserId, leadUserId },
      relations: { currency: true },
      order: { id: 'ASC' },
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

  private async assertAssignable(
    traderUserId: string,
    assignments: LeadAssignment[],
  ): Promise<void> {
    const trader = await this.directory.findById(traderUserId);

    if (!trader) throw new NotFoundException('User not found');

    if (trader.role !== Role.Trader) {
      throw new BadRequestException('Only a trader can have a lead');
    }

    for (const leadUserId of new Set(
      assignments.map((assignment) => assignment.leadUserId),
    )) {
      const lead = await this.directory.findById(leadUserId);

      if (!lead) throw new BadRequestException('Lead not found');

      if (lead.role !== Role.LeadTrader) {
        throw new BadRequestException('The lead must be a lead trader');
      }
    }

    const currencyIds = [
      ...new Set(assignments.map((assignment) => assignment.currencyId)),
    ];
    const found = new Set(
      (await this.currencies.findByIds(currencyIds)).map(
        (currency) => currency.id,
      ),
    );
    const missing = currencyIds.filter((id) => !found.has(id));

    if (missing.length) {
      throw new BadRequestException(
        `Currency ${missing.join(', ')} does not exist`,
      );
    }
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

      if (!members.some((known) => known.id === member.id)) {
        members.push({ id: member.id, login: loginOf(member) });
      }
      byOwner.set(ownerOf(link), members);
    }

    return byOwner;
  }
}

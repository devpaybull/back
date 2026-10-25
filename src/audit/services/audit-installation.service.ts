import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditInstallation } from '../entities/audit-installation.entity';

@Injectable()
export class AuditInstallationService {
  private pending: Promise<string> | null = null;

  constructor(
    @InjectRepository(AuditInstallation)
    private readonly installations: Repository<AuditInstallation>,
  ) {}

  installationId(): Promise<string> {
    this.pending ??= this.ensure().catch((error: unknown) => {
      this.pending = null;
      throw error;
    });

    return this.pending;
  }

  private async ensure(): Promise<string> {
    await this.installations
      .createQueryBuilder()
      .insert()
      .into(AuditInstallation)
      .values({ singleton: true })
      .orIgnore()
      .execute();

    const row = await this.installations.findOneByOrFail({ singleton: true });

    return row.installationId;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityRead } from '../entities/activity-read.entity';
import { ActivityReadScope } from '../types/activity-read-scope.enum';

@Injectable()
export class ActivityReadsService {
  constructor(
    @InjectRepository(ActivityRead)
    private readonly reads: Repository<ActivityRead>,
  ) {}

  async lastReadAt(
    userId: string,
    scope: ActivityReadScope,
  ): Promise<Date | null> {
    const read = await this.reads.findOne({ where: { userId, scope } });

    return read?.lastReadAt ?? null;
  }

  async markRead(
    userId: string,
    scope: ActivityReadScope,
    at: Date,
  ): Promise<Date> {
    await this.reads.upsert({ userId, scope, lastReadAt: at }, [
      'userId',
      'scope',
    ]);

    return at;
  }
}

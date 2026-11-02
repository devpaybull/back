import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CounterpartyDailyVolume } from './entities/counterparty-daily-volume.entity';
import { CounterpartyRequisiteEvent } from './entities/counterparty-requisite-event.entity';
import { Counterparty } from './entities/counterparty.entity';
import { CounterpartiesService } from './services/counterparties.service';
import { CounterpartyStatsService } from './services/counterparty-stats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Counterparty,
      CounterpartyDailyVolume,
      CounterpartyRequisiteEvent,
    ]),
    AuditModule,
  ],
  providers: [CounterpartiesService, CounterpartyStatsService],
  exports: [CounterpartiesService, CounterpartyStatsService],
})
export class CounterpartiesModule {}

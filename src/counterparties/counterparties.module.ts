import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CounterpartyDailyRequest } from './entities/counterparty-daily-request.entity';
import { CounterpartyDailyVolume } from './entities/counterparty-daily-volume.entity';
import { CounterpartyRequisiteEvent } from './entities/counterparty-requisite-event.entity';
import { CounterpartyTraderDailyVolume } from './entities/counterparty-trader-daily-volume.entity';
import { CounterpartyTraderStats } from './entities/counterparty-trader-stats.entity';
import { Counterparty } from './entities/counterparty.entity';
import { CounterpartiesService } from './services/counterparties.service';
import { CounterpartyStatsService } from './services/counterparty-stats.service';
import { TraderCounterpartiesService } from './services/trader-counterparties.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Counterparty,
      CounterpartyDailyVolume,
      CounterpartyDailyRequest,
      CounterpartyRequisiteEvent,
      CounterpartyTraderStats,
      CounterpartyTraderDailyVolume,
    ]),
    AuditModule,
  ],
  providers: [
    CounterpartiesService,
    CounterpartyStatsService,
    TraderCounterpartiesService,
  ],
  exports: [
    CounterpartiesService,
    CounterpartyStatsService,
    TraderCounterpartiesService,
  ],
})
export class CounterpartiesModule {}

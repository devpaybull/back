import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CounterpartiesService } from './counterparties.service';
import { Counterparty } from './entities/counterparty.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Counterparty])],
  providers: [CounterpartiesService],
  exports: [CounterpartiesService],
})
export class CounterpartiesModule {}

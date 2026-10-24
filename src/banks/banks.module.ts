import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CountriesModule } from '../countries/countries.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { BanksService } from './banks.service';
import { Bank } from './entities/bank.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Bank]),
    CountriesModule,
    CurrenciesModule,
  ],
  providers: [BanksService],
  exports: [BanksService],
})
export class BanksModule {}

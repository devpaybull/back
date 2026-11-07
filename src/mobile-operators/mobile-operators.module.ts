import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CountriesModule } from '../countries/countries.module';
import { MobileOperator } from './entities/mobile-operator.entity';
import { MobileOperatorsService } from './mobile-operators.service';

@Module({
  imports: [TypeOrmModule.forFeature([MobileOperator]), CountriesModule],
  providers: [MobileOperatorsService],
  exports: [MobileOperatorsService],
})
export class MobileOperatorsModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BankDetailsModule } from './bank-details/bank-details.module';
import { BanksModule } from './banks/banks.module';
import { validateEnv } from './common/config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { CounterpartiesModule } from './counterparties/counterparties.module';
import { CountriesModule } from './countries/countries.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { DebtsModule } from './debts/debts.module';
import { DevicesModule } from './devices/devices.module';
import { InvitesModule } from './invites/invites.module';
import { MerchantsModule } from './merchants/merchants.module';
import { TraderSettingsModule } from './trader-settings/trader-settings.module';
import { TransactionsModule } from './transactions/transactions.module';
import { UserNotesModule } from './user-notes/user-notes.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        ssl: config.get<boolean>('DB_SSL'),
        synchronize: config.get<boolean>('DB_SYNCHRONIZE'),
        logging: config.get<boolean>('DB_LOGGING'),
        autoLoadEntities: true,
      }),
    }),
    UsersModule,
    InvitesModule,
    AuthModule,
    CountriesModule,
    CurrenciesModule,
    BanksModule,
    DevicesModule,
    BankDetailsModule,
    MerchantsModule,
    CounterpartiesModule,
    TransactionsModule,
    AuditModule,
    TraderSettingsModule,
    AnalyticsModule,
    UserNotesModule,
    DebtsModule,
    AdminModule,
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}

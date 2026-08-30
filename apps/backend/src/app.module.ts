import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { PrismaModule } from './prisma/prisma.module';

import { AuthModule } from './auth/auth.module';
import { BotModule } from './bot/bot.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthController } from './health/health.controller';
import { LeadsModule } from './leads/leads.module';
import { MaintenanceService } from './maintenance/maintenance.service';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { SheetsModule } from './sheets/sheets.module';
import { TenantModule } from './tenant/tenant.module';
import { WebhookModule } from './webhook/webhook.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
      envFilePath: ['.env', '../../.env'],
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
        },
      }),
    }),

    // Provider webhooks are exempt (see WebhookController) - this protects the
    // admin API from brute-force login attempts.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    ScheduleModule.forRoot(),

    PrismaModule,
    // Global, and before everything that resolves a tenant. Its onModuleInit
    // guarantees the default tenant exists before settings are seeded.
    TenantModule,
    SettingsModule,
    AuthModule,
    WhatsappModule,
    SheetsModule,
    NotificationsModule,
    LeadsModule,
    CustomersModule,
    ConversationsModule,
    BotModule,
    WebhookModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [MaintenanceService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

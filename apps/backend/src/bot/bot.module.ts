import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { BotEngineService } from './bot-engine.service';
import { BotFlowsController } from './bot-flows.controller';
import { BotService } from './bot.service';
import { OrderLookupService } from './order-lookup.service';

@Module({
  imports: [LeadsModule, WhatsappModule],
  controllers: [BotFlowsController],
  providers: [BotEngineService, BotService, OrderLookupService],
  exports: [BotService, BotEngineService],
})
export class BotModule {}

import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [BotModule, WhatsappModule],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}

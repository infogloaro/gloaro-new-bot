import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NOTIFY } from '../queue/queue.constants';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationsProcessor } from './notifications.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NOTIFY }), WhatsappModule],
  providers: [NotificationsProcessor],
  exports: [BullModule],
})
export class NotificationsModule {}

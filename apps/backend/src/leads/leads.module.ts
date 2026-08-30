import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NOTIFY, QUEUE_SHEETS } from '../queue/queue.constants';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_SHEETS }, { name: QUEUE_NOTIFY }),
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}

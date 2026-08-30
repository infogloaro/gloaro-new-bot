import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_SHEETS } from '../queue/queue.constants';
import { SheetsProcessor } from './sheets.processor';
import { SheetsService } from './sheets.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_SHEETS })],
  providers: [SheetsService, SheetsProcessor],
  exports: [SheetsService, BullModule],
})
export class SheetsModule {}

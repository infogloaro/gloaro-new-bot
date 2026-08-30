import { Global, Module, forwardRef } from '@nestjs/common';
import { SheetsModule } from '../sheets/sheets.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Global()
@Module({
  imports: [forwardRef(() => SheetsModule)],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}

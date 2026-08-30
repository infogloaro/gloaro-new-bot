import { Global, Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

/** Global: nearly every module needs to resolve or validate a tenant. */
@Global()
@Module({
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}

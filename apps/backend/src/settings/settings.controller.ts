import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.decorators';
import { SheetsService } from '../sheets/sheets.service';
import { TenantId } from '../tenant/tenant.decorator';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @IsObject() values!: Record<string, string>;
}

class UpdateOneDto {
  @IsString() key!: string;
  @IsString() value!: string;
}

class FindSettingsDto {
  @IsOptional() @IsString() group?: string;
  /** Accepted so SUPER_ADMIN can scope by query string; validated in the decorator. */
  @IsOptional() @IsString() tenantId?: string;
}

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly sheets: SheetsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'All settings for this tenant, optionally filtered by group' })
  findAll(@TenantId() tenantId: string, @Query() query: FindSettingsDto) {
    return this.settings.findAll(tenantId, query.group);
  }

  @Patch()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update several settings at once' })
  updateMany(@TenantId() tenantId: string, @Body() dto: UpdateSettingsDto) {
    return this.settings.updateMany(tenantId, dto.values);
  }

  @Patch('one')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateOne(@TenantId() tenantId: string, @Body() dto: UpdateOneDto) {
    return this.settings.update(tenantId, dto.key, dto.value);
  }

  @Post('test-sheet')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Verify the Google Sheet is reachable with the configured credentials' })
  testSheet(@TenantId() tenantId: string) {
    return this.sheets.testConnection(tenantId);
  }
}

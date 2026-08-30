import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.decorators';
import { TenantId } from '../tenant/tenant.decorator';
import { ProviderConfigService } from './provider-config.service';
import { PROVIDER_IDS, WhatsAppProviderId } from './provider.types';

class CreateProviderConfigDto {
  @IsIn(PROVIDER_IDS as unknown as string[])
  provider!: WhatsAppProviderId;

  @IsString() @MaxLength(20) phoneNumber!: string;

  @IsOptional() @IsString() @MaxLength(60) label?: string;

  /** Values are checked against the provider descriptor in the service. */
  @IsObject() credentials!: Record<string, string>;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateProviderConfigDto {
  @IsOptional() @IsString() @MaxLength(20) phoneNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsObject() credentials?: Record<string, string>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class SetEnabledDto {
  @IsBoolean() isActive!: boolean;
}

/**
 * Admin Dashboard → Settings → WhatsApp.
 *
 * Every route is tenant-scoped through `@TenantId()`, and the service refuses
 * any id that does not belong to that tenant, so an admin of one client cannot
 * read or touch another client's channel even with a valid account id.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly configs: ProviderConfigService) {}

  /** Provider catalogue: dropdown options and the fields each one needs. */
  @Get('providers')
  @ApiOperation({ summary: 'Supported providers with their configuration fields' })
  providers() {
    return this.configs.descriptors();
  }

  @Get('accounts')
  @ApiOperation({ summary: 'This tenant’s WhatsApp channels (credentials masked)' })
  findAll(@TenantId() tenantId: string) {
    return this.configs.findAll(tenantId);
  }

  @Get('accounts/:id')
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.configs.findOne(tenantId, id);
  }

  @Post('accounts')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Add a WhatsApp channel' })
  create(@TenantId() tenantId: string, @Body() dto: CreateProviderConfigDto) {
    return this.configs.create(tenantId, dto);
  }

  @Patch('accounts/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a channel. Blank secret fields keep their stored value.' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderConfigDto,
  ) {
    return this.configs.update(tenantId, id, dto);
  }

  @Delete('accounts/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.configs.remove(tenantId, id);
  }

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  @Post('accounts/:id/test')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Run the provider’s own connection check' })
  test(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.configs.testConnection(tenantId, id);
  }

  @Post('accounts/:id/connect')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Test and, if it passes, switch the channel on' })
  connect(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.configs.connect(tenantId, id);
  }

  @Post('accounts/:id/disconnect')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Stop the bot on this channel, keeping the credentials' })
  disconnect(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.configs.disconnect(tenantId, id);
  }

  @Patch('accounts/:id/enabled')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  setEnabled(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEnabledDto,
  ) {
    return this.configs.setEnabled(tenantId, id, dto.isActive);
  }

  @Post('accounts/:id/default')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Use this channel for outbound messages' })
  makeDefault(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.configs.makeDefault(tenantId, id);
  }

  // -------------------------------------------------------------------------
  // Webhook URL
  // -------------------------------------------------------------------------

  /** The full callback URL, secret included, for pasting into the provider. */
  @Get('accounts/:id/webhook-url')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  webhookUrl(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.configs.revealWebhookUrl(tenantId, id);
  }

  @Post('accounts/:id/rotate-webhook-secret')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Issue a new webhook secret. The URL must be re-registered.' })
  rotate(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.configs.rotateWebhookSecret(tenantId, id);
  }
}

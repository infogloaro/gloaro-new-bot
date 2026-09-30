import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../auth/auth.decorators';
import { TenantId } from '../tenant/tenant.decorator';
import { WebhookService } from './webhook.service';

/**
 * The admin-facing view of what providers have actually delivered.
 *
 * Separate from `WebhookController` on purpose: that one is the unauthenticated
 * provider callback surface and is excluded from the global `api` prefix, while
 * this is an ordinary guarded admin route at `/api/webhooks/events`.
 *
 * When a channel goes quiet the first question is whether the provider is
 * calling us at all. An empty list here answers it without reading deploy logs.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('webhooks')
export class WebhookEventsController {
  constructor(private readonly webhook: WebhookService) {}

  @Get('events')
  @ApiOperation({ summary: 'Recent provider webhook deliveries for this tenant' })
  events(
    @TenantId() tenantId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.webhook.recentEvents(tenantId, limit);
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.decorators';
import { TenantId } from '../tenant/tenant.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'All dashboard tiles in one call' })
  summary(@TenantId() tenantId: string) {
    return this.dashboard.summary(tenantId);
  }

  @Get('leads-trend')
  @ApiOperation({ summary: 'Daily lead counts for the chart' })
  trend(@TenantId() tenantId: string, @Query('days') days?: string) {
    return this.dashboard.leadsTrend(tenantId, parseInt(days ?? '14', 10));
  }
}

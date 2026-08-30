import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeadStatus, MainCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.decorators';
import { TenantId } from '../tenant/tenant.decorator';
import { LeadsService } from './leads.service';

class FindLeadsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsEnum(LeadStatus) status?: LeadStatus;
  @IsOptional() @IsEnum(MainCategory) mainCategory?: MainCategory;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

class UpdateStatusDto {
  @IsEnum(LeadStatus, { message: 'Status must be NEW, FOLLOW_UP or CLOSED' })
  status!: LeadStatus;
}

class AssignDto {
  @IsOptional() @IsUUID() userId?: string | null;
}

class AddNoteDto {
  @IsString() @MaxLength(2000) body!: string;
}

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @ApiOperation({ summary: 'List leads with search, filters and pagination' })
  findAll(@TenantId() tenantId: string, @Query() query: FindLeadsDto) {
    return this.leads.findAll(tenantId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Lead counts for the dashboard' })
  stats(@TenantId() tenantId: string) {
    return this.leads.stats(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One lead with its notes and customer' })
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.findOne(tenantId, id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Set lead status (New / Follow-up / Closed)' })
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.leads.updateStatus(tenantId, id, dto.status);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Assign the lead to a team member' })
  assign(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.leads.assign(tenantId, id, dto.userId ?? null);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to the lead' })
  addNote(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.leads.addNote(tenantId, id, userId, dto.body);
  }

  @Post(':id/retry-sync')
  @ApiOperation({ summary: 'Re-queue the Google Sheet append and admin notification' })
  retrySync(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.retrySync(tenantId, id);
  }
}

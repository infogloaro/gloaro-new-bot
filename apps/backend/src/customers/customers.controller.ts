import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/auth.decorators';
import { TenantId } from '../tenant/tenant.decorator';
import { CustomersService } from './customers.service';

class FindCustomersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

class BlockDto {
  @IsBoolean() isBlocked!: boolean;
}

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers' })
  findAll(@TenantId() tenantId: string, @Query() query: FindCustomersDto) {
    return this.customers.findAll(tenantId, query);
  }

  @Get('stats')
  findStats(@TenantId() tenantId: string) {
    return this.customers.stats(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer profile with leads and conversations' })
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.findOne(tenantId, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Full message history for a customer' })
  messages(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationDto,
  ) {
    return this.customers.messages(tenantId, id, query);
  }

  @Patch(':id/block')
  @ApiOperation({ summary: 'Block or unblock a customer' })
  setBlocked(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockDto,
  ) {
    return this.customers.setBlocked(tenantId, id, dto.isBlocked);
  }
}

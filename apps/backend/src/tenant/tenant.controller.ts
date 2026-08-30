import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.decorators';
import { TenantId } from './tenant.decorator';
import { TenantService } from './tenant.service';

class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'slug must be lowercase letters, digits and hyphens',
  })
  slug!: string;

  @IsString() @MinLength(2) @MaxLength(80) name!: string;
}

class UpdateTenantDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenants')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  /** Only the platform operator sees the client list. */
  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'All tenants (SUPER_ADMIN only)' })
  findAll() {
    return this.tenants.findAll();
  }

  /** Which tenant the caller is currently acting as - used by the admin shell. */
  @Get('current')
  @ApiOperation({ summary: 'The tenant this request resolves to' })
  current(@TenantId() tenantId: string) {
    return this.tenants.findById(tenantId);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }
}

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/auth.decorators';
import { TenantId } from '../tenant/tenant.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { BotService } from './bot.service';
import { IncomingMessage } from './bot-engine.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

class UpdateFlowDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) linkUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Label on the button that opens a MENU node's tappable list. */
  @IsOptional() @IsString() @MaxLength(20) menuButton?: string;
  /** Menu options, as [{ key, label, next, emoji?, description?, menuTitle? }]. */
  @IsOptional() options?: Prisma.InputJsonValue;
}

class CreateFlowDto {
  /** Stable node key referenced from other nodes' `next`/`nextKey`, e.g. MART_FAQ. */
  @IsString()
  @MaxLength(60)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'key must be UPPER_SNAKE_CASE, starting with a letter',
  })
  key!: string;

  @IsString() @MaxLength(200) name!: string;
  @IsIn(['MENU', 'MESSAGE', 'QUESTION', 'ACTION']) nodeType!: string;
  @IsString() @MaxLength(4000) body!: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) linkUrl?: string;
  @IsOptional() @IsString() @MaxLength(20) menuButton?: string;
  @IsOptional() options?: Prisma.InputJsonValue;
  @IsOptional() @IsInt() sortOrder?: number;
}

class SimulateDto {
  @IsString() @MaxLength(20) from!: string;
  @IsString() @MaxLength(2000) text!: string;
  @IsOptional() @IsString() @MaxLength(100) profileName?: string;
}

@ApiTags('Bot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bot')
export class BotFlowsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Get('flows')
  @ApiOperation({ summary: 'All bot flow nodes for the Bot Menu screen' })
  findAll(@TenantId() tenantId: string) {
    return this.prisma.botFlow.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
  }

  @Get('flows/:id')
  async findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    const flow = await this.prisma.botFlow.findFirst({ where: { id, tenantId } });
    if (!flow) throw new NotFoundException(`Flow node ${id} not found`);
    return flow;
  }

  @Patch('flows/:id')
  @ApiOperation({ summary: 'Edit a node’s message, media or options' })
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFlowDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.botFlow.update({ where: { id }, data: dto as Prisma.BotFlowUpdateInput });
  }

  @Post('flows')
  @ApiOperation({ summary: 'Create a new node, e.g. a menu option target the admin panel added' })
  async create(@TenantId() tenantId: string, @Body() dto: CreateFlowDto) {
    const existing = await this.prisma.botFlow.findFirst({ where: { tenantId, key: dto.key } });
    if (existing) throw new ConflictException(`A node with key ${dto.key} already exists`);
    const maxSort = await this.prisma.botFlow.aggregate({
      where: { tenantId },
      _max: { sortOrder: true },
    });
    return this.prisma.botFlow.create({
      data: {
        tenantId,
        key: dto.key,
        name: dto.name,
        nodeType: dto.nodeType,
        body: dto.body,
        imageUrl: dto.imageUrl,
        linkUrl: dto.linkUrl,
        menuButton: dto.menuButton,
        options: dto.options as Prisma.InputJsonValue,
        sortOrder: dto.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
      },
    });
  }

  @Delete('flows/:id')
  @ApiOperation({ summary: 'Delete a node, refused while another node still points to it' })
  async remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    const flow = await this.findOne(tenantId, id);
    if (flow.key === 'WELCOME') {
      throw new BadRequestException('The welcome / main menu node cannot be deleted');
    }
    const referrers = await this.prisma.botFlow.findMany({
      where: { tenantId, id: { not: id } },
      select: { key: true, nextKey: true, options: true },
    });
    const referencedBy = referrers.filter((r) => {
      if (r.nextKey === flow.key) return true;
      const options = Array.isArray(r.options) ? (r.options as Array<{ next?: string }>) : [];
      return options.some((o) => o.next === flow.key);
    });
    if (referencedBy.length > 0) {
      throw new ConflictException(
        `Cannot delete ${flow.key}: still referenced by ${referencedBy.map((r) => r.key).join(', ')}`,
      );
    }
    await this.prisma.botFlow.delete({ where: { id } });
    return { deleted: true };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Live bot sessions, newest activity first' })
  sessions(@TenantId() tenantId: string) {
    return this.prisma.botSession.findMany({
      where: { tenantId },
      include: {
        customer: { select: { whatsappNumber: true, name: true, profileName: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Runs a message through the real engine without a provider involved. This is
   * how every flow gets tested before a client has WhatsApp credentials, and it
   * is also the fastest way to reproduce a reported conversation bug.
   *
   * The message is built in the same normalised shape a real adapter produces,
   * so the simulator exercises the identical code path.
   */
  @Post('simulate')
  @ApiOperation({ summary: 'Send a test message through the bot engine' })
  async simulate(@TenantId() tenantId: string, @Body() dto: SimulateDto) {
    const customerNumber = dto.from.replace(/[^\d]/g, '');
    const incoming: IncomingMessage = {
      tenantId,
      // No provider: the simulator never touches a gateway, and a NULL provider
      // is what keeps these rows out of the real message-id unique constraint.
      provider: null,
      phoneNumber: 'simulator',
      customerNumber,
      messageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      messageType: 'text',
      messageText: dto.text,
      timestamp: new Date(),
      profileName: dto.profileName ?? 'Test User',
      raw: { simulated: true },
    };
    const replies = await this.bot.handleIncoming(incoming);
    return {
      sent: dto.text,
      replies: replies.map((r) => ({ node: r.node, body: r.body, menu: r.menu })),
    };
  }

  @Get('outbox')
  @ApiOperation({ summary: 'Messages the bot would have sent with no live channel configured' })
  async outbox(@TenantId() tenantId: string) {
    return {
      enabled: await this.whatsapp.isEnabled(tenantId),
      messages: this.whatsapp.getDryRunOutbox(tenantId),
    };
  }
}

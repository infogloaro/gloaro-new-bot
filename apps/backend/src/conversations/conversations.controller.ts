import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.decorators';
import { BotService } from '../bot/bot.service';
import { TenantId } from '../tenant/tenant.decorator';
import { ConversationsService } from './conversations.service';

class FindConversationsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsEnum(ConversationStatus) status?: ConversationStatus;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

class ReplyDto {
  @IsString() @MaxLength(4000) body!: string;
}

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly bot: BotService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List conversations' })
  findAll(@TenantId() tenantId: string, @Query() query: FindConversationsDto) {
    return this.conversations.findAll(tenantId, query);
  }

  @Get('stats')
  stats(@TenantId() tenantId: string) {
    return this.conversations.stats(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Conversation with its full message thread' })
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.findOne(tenantId, id);
  }

  @Post(':id/take-over')
  @ApiOperation({ summary: 'Silence the bot and handle this conversation yourself' })
  takeOver(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') agentId: string,
  ) {
    return this.conversations.takeOver(tenantId, id, agentId);
  }

  @Post(':id/release')
  @ApiOperation({ summary: 'Hand the conversation back to the bot' })
  release(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.release(tenantId, id);
  }

  @Post(':id/close')
  close(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.close(tenantId, id);
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Send a manual WhatsApp reply as an agent' })
  async reply(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
    @CurrentUser('id') agentId: string,
  ) {
    const conversation = await this.conversations.findOne(tenantId, id);
    return this.bot.sendManualReply(tenantId, conversation.customerId, dto.body, agentId);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WhatsAppProviderConfig, WhatsAppProviderType } from '@prisma/client';
import { BotService } from '../bot/bot.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderConfigService } from '../whatsapp/provider-config.service';
import {
  NormalizedInboundMessage,
  NormalizedStatusEvent,
  WebhookVerificationContext,
} from '../whatsapp/provider.types';
import { WhatsAppProvider } from '../whatsapp/providers/provider.base';

/**
 * Turns a verified provider callback into bot work.
 *
 *   provider webhook -> adapter.parseWebhook -> normalised message
 *     -> tenant stamped on -> idempotency claim -> BotService
 *
 * Everything downstream of here is provider-agnostic: the bot engine has no
 * idea which gateway a message arrived on.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotService,
    private readonly configs: ProviderConfigService,
  ) {}

  async process(
    row: WhatsAppProviderConfig,
    adapter: WhatsAppProvider,
    ctx: WebhookVerificationContext,
  ): Promise<void> {
    let parsed;
    try {
      parsed = adapter.parseWebhook(ctx);
    } catch (err) {
      this.logger.error(
        `Could not parse ${row.provider} webhook: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    if (parsed.messages.length) {
      await this.configs.noteInbound(row.id);
    }

    for (const status of parsed.statuses) {
      await this.handleStatus(status);
    }

    for (const message of parsed.messages) {
      await this.handleMessage(
        { ...message, tenantId: row.tenantId, providerConfigId: row.id },
        row,
      );
    }
  }

  /**
   * Claims the message id before doing any work. If the insert hits the unique
   * constraint the message is a redelivery and is dropped - this is what
   * guarantees one reply and one lead per customer message, even when a
   * provider retries because our own reply took too long.
   */
  private async handleMessage(
    message: NormalizedInboundMessage,
    row: WhatsAppProviderConfig,
  ): Promise<void> {
    const key = {
      provider_providerMessageId: {
        provider: message.provider as WhatsAppProviderType,
        providerMessageId: message.messageId,
      },
    };

    try {
      await this.prisma.webhookEvent.create({
        data: {
          tenantId: message.tenantId,
          provider: message.provider as WhatsAppProviderType,
          providerMessageId: message.messageId,
          eventType: 'message',
          fromNumber: message.customerNumber,
          payload: (message.raw ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Duplicate ${message.provider} webhook ${message.messageId} - ignored`);
        await this.prisma.webhookEvent
          .update({ where: key, data: { status: 'DUPLICATE' } })
          .catch(() => undefined);
        return;
      }
      throw err;
    }

    try {
      await this.bot.handleIncoming(message, row);
      await this.prisma.webhookEvent.update({
        where: key,
        data: { status: 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 } },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to handle message ${message.messageId}: ${errorMessage}`);
      await this.prisma.webhookEvent.update({
        where: key,
        data: { status: 'FAILED', errorMessage, attempts: { increment: 1 } },
      });
    }
  }

  /** Delivery receipts - update the outbound message row if we know it. */
  private async handleStatus(status: NormalizedStatusEvent): Promise<void> {
    await this.prisma.message
      .update({
        where: {
          provider_providerMessageId: {
            provider: status.provider as WhatsAppProviderType,
            providerMessageId: status.messageId,
          },
        },
        data: {
          status: status.status,
          ...(status.error ? { errorMessage: status.error } : {}),
        },
      })
      .catch(() => {
        // A status for a message we did not send, one already pruned, or a
        // provider whose send response and status webhook use different ids.
        // Nothing to correlate - not an error.
      });
  }

  /** Admin panel: recent webhook deliveries for this tenant, for debugging. */
  async recentEvents(tenantId: string, limit = 50) {
    return this.prisma.webhookEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, limit),
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppProviderConfig } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { MENU_LIMITS } from './menu';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SendOutcome } from '../whatsapp/whatsapp.service';
import { BotEngineService, IncomingMessage, OutboundMessage } from './bot-engine.service';

/**
 * Ties the engine to WhatsApp: runs the flow, then delivers each reply through
 * the provider-independent `WhatsappService` and records it against the
 * conversation.
 *
 * There is exactly one delivery path for every provider. Nothing here knows
 * which gateway is in use.
 */
@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: BotEngineService,
    private readonly whatsapp: WhatsappService,
    private readonly settings: SettingsService,
  ) {}

  async handleIncoming(
    incoming: IncomingMessage,
    account?: WhatsAppProviderConfig,
  ): Promise<OutboundMessage[]> {
    const replies = await this.engine.handleMessage(incoming);

    if (replies.length) {
      await this.deliver(incoming.tenantId, incoming.customerNumber, replies, account);
    }
    return replies;
  }

  /** Sends each reply in order and stores it as an OUTBOUND message. */
  async deliver(
    tenantId: string,
    to: string,
    messages: OutboundMessage[],
    account?: WhatsAppProviderConfig,
  ): Promise<void> {
    const whatsappNumber = to.replace(/[^\d]/g, '');
    const customer = await this.prisma.customer.findUnique({
      where: { tenantId_whatsappNumber: { tenantId, whatsappNumber } },
    });
    const conversation = customer
      ? await this.prisma.conversation.findFirst({
          where: { tenantId, customerId: customer.id, status: { in: ['ACTIVE', 'IDLE'] } },
          orderBy: { lastMessageAt: 'desc' },
        })
      : null;

    for (const msg of messages) {
      // A node with an image sends it as its own message first, ahead of the
      // text/menu below - WhatsApp cannot attach an interactive list to media.
      if (msg.imageUrl) {
        const imageResult = await this.whatsapp.send(
          tenantId,
          { type: 'image', to: whatsappNumber, node: msg.node, mediaUrl: msg.imageUrl },
          account?.id,
        );

        if (customer && conversation) {
          await this.prisma.message.create({
            data: {
              tenantId,
              conversationId: conversation.id,
              customerId: customer.id,
              direction: 'OUTBOUND',
              type: 'image',
              body: msg.imageUrl,
              botNode: msg.node,
              provider: imageResult.provider,
              providerConfigId: imageResult.providerConfigId ?? account?.id ?? null,
              providerMessageId: imageResult.messageId ?? null,
              status: imageResult.success ? 'SENT' : 'FAILED',
              errorMessage: imageResult.error ?? null,
              sentAt: imageResult.success ? new Date() : null,
            },
          });
        }

        if (!imageResult.success) {
          this.logger.error(
            `Failed to deliver image for ${msg.node}: [${imageResult.errorCode}] ${imageResult.error}`,
          );
          // The text/menu still carries the actual content, so keep going.
        }
      }

      // Reply on the channel the customer wrote to, not the tenant default -
      // a tenant with two numbers must not answer from the wrong one.
      const { result, body, type } = await this.sendOne(
        tenantId,
        whatsappNumber,
        msg,
        account?.id,
      );

      if (customer && conversation) {
        await this.prisma.message.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            customerId: customer.id,
            direction: 'OUTBOUND',
            type,
            body,
            botNode: msg.node,
            provider: result.provider,
            providerConfigId: result.providerConfigId ?? account?.id ?? null,
            providerMessageId: result.messageId ?? null,
            status: result.success ? 'SENT' : 'FAILED',
            errorMessage: result.error ?? null,
            sentAt: result.success ? new Date() : null,
          },
        });
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
        });
      }

      if (!result.success) {
        this.logger.error(`Failed to deliver ${msg.node}: [${result.errorCode}] ${result.error}`);
        // Stop the sequence - later messages would arrive without their context.
        break;
      }
    }
  }

  /**
   * Sends one engine reply, choosing between a tappable WhatsApp list and the
   * numbered text version.
   *
   * The interactive attempt is free to try: `WhatsappService` checks the
   * adapter's declared capabilities before it makes any HTTP call, so a channel
   * that cannot do lists (UltraMsg) comes straight back as UNSUPPORTED and we
   * fall through to text without a wasted round trip. That is what lets one
   * bot flow serve every provider.
   */
  private async sendOne(
    tenantId: string,
    to: string,
    msg: OutboundMessage,
    accountId?: string,
  ): Promise<{ result: SendOutcome; body: string; type: string }> {
    const numbered = msg.numberedBody ?? msg.body;

    const interactiveAllowed =
      msg.menu !== undefined &&
      this.settings.get(tenantId, 'bot.menuStyle', 'interactive') !== 'numbered';

    if (interactiveAllowed && msg.menu) {
      const result = await this.whatsapp.send(
        tenantId,
        {
          type: 'list',
          to,
          node: msg.node,
          text: msg.body.slice(0, MENU_LIMITS.body),
          buttonText: msg.menu.buttonText,
          sections: [{ title: msg.menu.buttonText, rows: msg.menu.items }],
        },
        accountId,
      );

      if (result.success) {
        // Stored as the plain text a human reader expects in the admin thread.
        return { result, body: numbered, type: 'interactive' };
      }

      if (result.errorCode !== 'UNSUPPORTED') {
        return { result, body: numbered, type: 'interactive' };
      }

      this.logger.debug(
        `Channel cannot send lists; falling back to numbered text for ${msg.node}`,
      );
    }

    const result = await this.whatsapp.sendText(tenantId, to, numbered, msg.node, accountId);
    return { result, body: numbered, type: 'text' };
  }

  /** Used by the admin panel to send a manual reply from the Conversations screen. */
  async sendManualReply(tenantId: string, customerId: string, body: string, agentId: string) {
    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { id: customerId, tenantId },
    });
    const conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, customerId, status: { in: ['ACTIVE', 'IDLE'] } },
      orderBy: { lastMessageAt: 'desc' },
    });

    // Answer on whichever channel this customer last reached us on.
    const lastInbound = conversation
      ? await this.prisma.message.findFirst({
          where: { conversationId: conversation.id, direction: 'INBOUND' },
          orderBy: { createdAt: 'desc' },
          select: { providerConfigId: true },
        })
      : null;

    const result = await this.whatsapp.sendText(
      tenantId,
      customer.whatsappNumber,
      body,
      'AGENT_REPLY',
      lastInbound?.providerConfigId ?? undefined,
    );

    if (conversation) {
      await this.prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          customerId,
          direction: 'OUTBOUND',
          type: 'text',
          body,
          botNode: 'AGENT_REPLY',
          provider: result.provider,
          providerConfigId: result.providerConfigId,
          providerMessageId: result.messageId ?? null,
          status: result.success ? 'SENT' : 'FAILED',
          errorMessage: result.error ?? null,
          sentAt: result.success ? new Date() : null,
        },
      });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          messageCount: { increment: 1 },
          isHandedOver: true,
          agentId,
        },
      });
    }

    return result;
  }
}

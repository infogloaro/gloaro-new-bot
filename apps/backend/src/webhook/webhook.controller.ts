import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { ProviderConfigService } from '../whatsapp/provider-config.service';
import { WebhookVerificationContext } from '../whatsapp/provider.types';
import { providerFromSlug } from '../whatsapp/providers/provider.registry';
import { WebhookService } from './webhook.service';

/** Express request carrying the raw body captured for signature verification. */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * One endpoint per provider:
 *
 *   POST /webhooks/whatsapp/ultramsg/:accountId
 *   POST /webhooks/whatsapp/gupshup/:accountId
 *   POST /webhooks/whatsapp/aisensy/:accountId
 *   POST /webhooks/whatsapp/360dialog/:accountId
 *
 * The account id in the path is what identifies the tenant - routing never
 * depends on guessing from the payload. The adapter then verifies the request
 * is genuine (HMAC where the provider signs, the per-account URL token where it
 * does not) and normalises the body. Only normalised messages go any further.
 *
 * Providers retry anything they do not get a 2xx for within a few seconds, so
 * these handlers answer immediately and process in the background.
 */
@SkipThrottle()
@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly configs: ProviderConfigService,
    private readonly webhook: WebhookService,
  ) {}

  /**
   * Some providers probe the URL with a GET before accepting it. Answering 200
   * with the echo parameter, when there is one, satisfies every provider we
   * support without pretending to be Meta's hub.challenge handshake.
   */
  @Get(':slug/:accountId')
  @HttpCode(200)
  async verify(
    @Param('slug') slug: string,
    @Param('accountId') accountId: string,
    @Query() query: Record<string, string>,
  ): Promise<string> {
    const provider = providerFromSlug(slug);
    if (!provider) throw new NotFoundException('Unknown provider');

    const row = await this.configs.routeInbound(provider, accountId);
    if (!row) throw new NotFoundException('Unknown WhatsApp account');

    this.logger.log(`Webhook probe for ${provider} account ${accountId}`);
    return query['hub.challenge'] ?? query.challenge ?? 'OK';
  }

  @Post(':slug/:accountId')
  @HttpCode(200)
  async receive(
    @Param('slug') slug: string,
    @Param('accountId') accountId: string,
    @Req() req: RawBodyRequest,
  ): Promise<string> {
    const provider = providerFromSlug(slug);
    if (!provider) throw new NotFoundException('Unknown provider');

    const row = await this.configs.routeInbound(provider, accountId);
    if (!row) {
      // Deliberately the same 404 as an unknown provider: an attacker probing
      // account ids learns nothing about which ones exist.
      this.logger.warn(`Webhook for unknown ${provider} account ${accountId}`);
      throw new NotFoundException('Unknown WhatsApp account');
    }

    const ctx: WebhookVerificationContext = {
      headers: req.headers,
      query: req.query as Record<string, unknown>,
      rawBody: req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
      body: req.body,
    };

    let adapter;
    try {
      adapter = this.configs.adapterFor(row);
    } catch (err) {
      this.logger.error(
        `Cannot build ${provider} adapter for account ${accountId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      // 200 on purpose: the provider retrying will not fix a broken credential,
      // and the admin panel already shows the account as errored.
      return 'EVENT_RECEIVED';
    }

    if (!adapter.verifyWebhook(ctx)) {
      this.logger.warn(`Rejected ${provider} webhook for account ${accountId}: failed verification`);
      throw new ForbiddenException('Invalid webhook signature or token');
    }

    if (!row.isActive) {
      this.logger.debug(`Ignoring ${provider} webhook: account ${accountId} is disconnected`);
      return 'EVENT_RECEIVED';
    }

    // Deliberately not awaited: the provider must get its 200 straight away.
    void this.webhook.process(row, adapter, ctx).catch((err) => {
      this.logger.error(`Webhook processing failed: ${err instanceof Error ? err.stack : err}`);
    });

    return 'EVENT_RECEIVED';
  }
}

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
   * support.
   *
   * Meta's handshake is the one that carries a secret: it sends hub.mode plus
   * the hub.verify_token configured in the app dashboard, and echoing the
   * challenge back regardless would make its "Verified" tick meaningless - a
   * mistyped token would still look healthy while no message ever arrives. So
   * whenever a verify token is present it must match before we echo. Probes
   * that carry no token (every other provider) are unchanged.
   */
  @Get(':slug/:accountId')
  @HttpCode(200)
  async verify(
    @Param('slug') slug: string,
    @Param('accountId') accountId: string,
    @Query() query: Record<string, string>,
    @Req() req: RawBodyRequest,
  ): Promise<string> {
    const provider = providerFromSlug(slug);
    if (!provider) throw new NotFoundException('Unknown provider');

    const row = await this.configs.routeInbound(provider, accountId);
    if (!row) throw new NotFoundException('Unknown WhatsApp account');

    if (query['hub.verify_token'] !== undefined) {
      let adapter;
      try {
        adapter = this.configs.adapterFor(row);
      } catch (err) {
        this.logger.error(
          `Cannot build ${provider} adapter for account ${accountId}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        throw new ForbiddenException('Invalid webhook verify token');
      }

      // The `token` the callback URL carries would satisfy the adapter's
      // catch-all fallback on its own, which would let a mistyped verify token
      // through and put us right back to a meaningless "Verified" tick. Drop it
      // so this handshake can only be answered by the verify token itself.
      const { token: _urlToken, ...handshakeQuery } = query;
      const ctx: WebhookVerificationContext = {
        headers: req.headers,
        query: handshakeQuery as Record<string, unknown>,
        rawBody: Buffer.alloc(0),
        body: undefined,
      };

      if (!adapter.verifyWebhook(ctx)) {
        this.logger.warn(
          `Rejected ${provider} webhook handshake for account ${accountId}: verify token mismatch`,
        );
        throw new ForbiddenException('Invalid webhook verify token');
      }
    }

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

    // Logged before anything can reject it: when a channel goes quiet, the first
    // question is always whether the provider is calling us at all, and silence
    // here answers it without guesswork.
    this.logger.log(`Inbound ${provider} webhook for account ${accountId}`);

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

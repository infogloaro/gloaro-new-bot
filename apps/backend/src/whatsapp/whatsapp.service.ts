import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppProviderType } from '@prisma/client';
import { ProviderConfigService } from './provider-config.service';
import {
  OutboundMessage,
  OutboundTextMessage,
  ProviderCapabilities,
  ProviderError,
  ProviderErrorCode,
  SendResult,
} from './provider.types';

/** Transient conditions worth one more attempt; everything else fails fast. */
const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set(['TIMEOUT', 'NETWORK', 'PROVIDER_ERROR']);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

export interface SentMessageMeta {
  provider: WhatsAppProviderType | null;
  providerConfigId: string | null;
}

export type SendOutcome = SendResult & SentMessageMeta;

/**
 * The only way anything in GloAro sends a WhatsApp message.
 *
 * Callers hand it a tenant and a provider-independent message; it picks that
 * tenant's live channel, translates through the adapter and reports a uniform
 * result. The bot engine, the notification worker and the agent reply box all
 * go through here, which is what makes swapping a client's provider a
 * configuration change rather than a code change.
 *
 * With no channel configured the service runs in dry-run mode: replies are
 * logged and given a synthetic id, so the whole bot can be developed and
 * demonstrated before any provider account exists.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  /** Captures dry-run sends so the local simulator can show what the bot replied. */
  private readonly dryRunOutbox: Array<{ tenantId: string; to: string; body: string; at: Date }> = [];

  constructor(private readonly configs: ProviderConfigService) {}

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /** Convenience for the common case. Kept because most of the bot is text. */
  sendText(
    tenantId: string,
    to: string,
    body: string,
    node?: string,
    accountId?: string,
  ): Promise<SendOutcome> {
    const message: OutboundTextMessage = { type: 'text', to, text: body, previewUrl: true, node };
    return this.send(tenantId, message, accountId);
  }

  /**
   * Delivers one message.
   *
   * `accountId` names the channel to use and is how a reply goes back out on
   * the same number the customer wrote to; without it the tenant's default
   * channel is used, which is what an unprompted message (an admin lead alert)
   * should do.
   *
   * Never throws: a provider outage has to surface as a failed message row and
   * a logged conversation, not as an exception that takes down webhook
   * processing or a queue worker mid-batch.
   */
  async send(
    tenantId: string,
    message: OutboundMessage,
    accountId?: string,
  ): Promise<SendOutcome> {
    const row = accountId
      ? await this.configs.activeConfigById(tenantId, accountId)
      : await this.configs.activeConfig(tenantId);

    if (!row) {
      return this.dryRun(tenantId, message);
    }

    let adapter;
    try {
      adapter = this.configs.adapterFor(row);
    } catch (err) {
      return {
        ...this.describe(err),
        provider: row.provider,
        providerConfigId: row.id,
      };
    }

    if (!adapter.capabilities.send.includes(message.type)) {
      // A standardised capability refusal, so the caller can fall back to text
      // rather than guessing why nothing arrived.
      return {
        success: false,
        errorCode: 'UNSUPPORTED',
        error: `${row.provider} cannot send "${message.type}" messages`,
        provider: row.provider,
        providerConfigId: row.id,
      };
    }

    let last: SendResult = { success: false, errorCode: 'PROVIDER_ERROR', error: 'not attempted' };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await adapter.send(message);
        return { ...result, provider: row.provider, providerConfigId: row.id };
      } catch (err) {
        last = this.describe(err);

        const retryable = last.errorCode ? RETRYABLE.has(last.errorCode) : false;
        if (!retryable || attempt === MAX_ATTEMPTS) break;

        const wait = last.retryAfterSeconds
          ? last.retryAfterSeconds * 1000
          : BASE_BACKOFF_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `Send via ${row.provider} failed (${last.errorCode}), retrying in ${wait}ms ` +
            `[attempt ${attempt}/${MAX_ATTEMPTS}]`,
        );
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 5_000)));
      }
    }

    // Recipient is never logged in full - it is customer PII.
    this.logger.error(
      `Send via ${row.provider} to ${ProviderConfigService.maskNumber(message.to)} failed: ${last.error}`,
    );

    // Auth and configuration failures are the channel's problem, not this
    // message's, so they are surfaced on the account in the admin panel.
    if (last.errorCode === 'AUTH' || last.errorCode === 'NOT_CONFIGURED') {
      await this.configs.noteSendFailure(row.id, last.error ?? 'Authentication failed');
    }

    return { ...last, provider: row.provider, providerConfigId: row.id };
  }

  /** What the tenant's live channel can actually do, for the admin UI and the engine. */
  async capabilities(tenantId: string): Promise<ProviderCapabilities | null> {
    const adapter = await this.configs.activeAdapter(tenantId).catch(() => null);
    return adapter?.capabilities ?? null;
  }

  async isEnabled(tenantId: string): Promise<boolean> {
    return (await this.configs.activeConfig(tenantId)) !== null;
  }

  // -------------------------------------------------------------------------
  // Dry run
  // -------------------------------------------------------------------------

  private dryRun(tenantId: string, message: OutboundMessage): SendOutcome {
    const body = message.type === 'text' ? message.text : `[${message.type}]`;
    this.dryRunOutbox.push({ tenantId, to: message.to, body, at: new Date() });
    if (this.dryRunOutbox.length > 200) this.dryRunOutbox.shift();

    this.logger.log(`[DRY RUN] -> ${ProviderConfigService.maskNumber(message.to)}\n${body}`);
    return {
      success: true,
      messageId: `dryrun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      provider: null,
      providerConfigId: null,
    };
  }

  /** Messages the bot would have sent, for the local simulator. */
  getDryRunOutbox(tenantId: string, limit = 50) {
    return this.dryRunOutbox.filter((m) => m.tenantId === tenantId).slice(-limit);
  }

  // -------------------------------------------------------------------------
  // Errors
  // -------------------------------------------------------------------------

  /** Turns anything thrown by an adapter into a uniform, credential-free result. */
  private describe(err: unknown): SendResult {
    if (err instanceof ProviderError) {
      return {
        success: false,
        errorCode: err.code,
        error: err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      };
    }
    return {
      success: false,
      errorCode: 'PROVIDER_ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

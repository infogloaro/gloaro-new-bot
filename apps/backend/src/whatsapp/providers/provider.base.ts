import { Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';
import {
  ConnectionTestResult,
  OutboundMessage,
  ParsedWebhook,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderError,
  ProviderErrorCode,
  ResolvedProviderConfig,
  SendResult,
  WebhookVerificationContext,
  WhatsAppProviderId,
} from '../provider.types';

/** Every provider call gets the same ceiling; a hung vendor must not hold a worker. */
export const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * One adapter instance per tenant account, built by `ProviderFactory` and cached
 * until the account's configuration changes.
 *
 * Subclasses translate the provider-independent `OutboundMessage` union into one
 * vendor's request shape, and that vendor's webhook payload back into the
 * normalised inbound shape. They must never touch the database, the bot engine
 * or Nest's DI container - everything they need arrives in the constructor.
 */
export abstract class WhatsAppProvider {
  abstract readonly id: WhatsAppProviderId;
  abstract readonly capabilities: ProviderCapabilities;

  protected readonly logger: Logger;
  protected readonly http: AxiosInstance;

  constructor(protected readonly config: ResolvedProviderConfig) {
    this.logger = new Logger(`${this.constructor.name}`);
    this.http = axios.create({
      timeout: PROVIDER_TIMEOUT_MS,
      // Statuses are inspected by hand so a 4xx yields a typed error rather
      // than an axios stack trace that could carry the request headers.
      validateStatus: () => true,
    });
  }

  /** Static metadata: form fields, capabilities, docs. Implemented as a static too. */
  abstract descriptor(): ProviderDescriptor;

  /**
   * Delivers one message. Implementations should throw `ProviderError`;
   * `WhatsAppService` turns both that and unexpected errors into a `SendResult`.
   */
  abstract send(message: OutboundMessage): Promise<SendResult>;

  /** Cheapest authenticated call the provider offers, used by "Test connection". */
  abstract testConnection(): Promise<ConnectionTestResult>;

  /**
   * Decides whether an inbound webhook request genuinely came from the provider
   * for this account. Returning false makes the controller answer 403.
   */
  abstract verifyWebhook(ctx: WebhookVerificationContext): boolean;

  /** Collapses one webhook body into normalised messages and status events. */
  abstract parseWebhook(ctx: WebhookVerificationContext): ParsedWebhook;

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  /** The business number this adapter sends from. */
  get phoneNumber(): string {
    return this.config.phoneNumber;
  }

  protected credential(name: string): string {
    return this.config.credentials[name] ?? '';
  }

  protected requireCredential(name: string, label = name): string {
    const value = this.credential(name).trim();
    if (!value) {
      throw new ProviderError('NOT_CONFIGURED', `${label} is not configured`);
    }
    return value;
  }

  /** Strips everything but digits. Providers disagree on '+', all accept digits. */
  protected static msisdn(value: string): string {
    const digits = (value ?? '').replace(/\D/g, '');
    if (digits.length < 8) {
      throw new ProviderError('INVALID_RECIPIENT', `"${value}" is not a valid WhatsApp number`);
    }
    return digits;
  }

  /** Declares a message kind this adapter cannot deliver, in a uniform way. */
  protected unsupported(message: OutboundMessage): never {
    throw new ProviderError(
      'UNSUPPORTED',
      `${this.id} does not support sending "${message.type}" messages`,
    );
  }

  /**
   * Runs a provider HTTP call and maps transport-level failures to
   * `ProviderError`. Response bodies are returned untouched for the caller to
   * interpret; only the status is classified here.
   */
  protected async request<T = unknown>(
    cfg: AxiosRequestConfig,
  ): Promise<{ status: number; data: T }> {
    try {
      const res = await this.http.request<T>(cfg);
      const classified = this.classifyStatus(res.status, res.data, res.headers ?? {});
      if (classified) throw classified;
      return { status: res.status, data: res.data };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (axios.isAxiosError(err)) {
        const code: ProviderErrorCode =
          err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'NETWORK';
        throw new ProviderError(code, err.message);
      }
      throw new ProviderError('PROVIDER_ERROR', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Maps an HTTP status onto a typed error, or null to let the caller inspect
   * the response itself.
   *
   * The distinction matters beyond tidiness: `WhatsAppService` treats an AUTH
   * failure as the *channel* being broken and flags it in the admin panel, so a
   * provider that answers 403 for a per-message reason must override this and
   * say so, or one bad recipient makes a healthy channel look disconnected.
   */
  protected classifyStatus(
    status: number,
    data: unknown,
    headers: Record<string, unknown>,
  ): ProviderError | null {
    if (status === 401 || status === 403) {
      return new ProviderError('AUTH', this.summarise(data) || 'Authentication rejected');
    }
    if (status === 429) {
      const retryAfter = Number(headers['retry-after']);
      return new ProviderError(
        'RATE_LIMITED',
        this.summarise(data) || 'Rate limited by the provider',
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    return null;
  }

  /**
   * Turns an arbitrary error body into one short line safe to store and show.
   * Truncated hard so a vendor HTML error page cannot flood the message column.
   */
  protected summarise(data: unknown): string {
    if (data == null) return '';
    if (typeof data === 'string') return data.slice(0, 300).trim();
    const obj = data as Record<string, unknown>;
    const candidate =
      obj.error ??
      obj.message ??
      obj.errorMessage ??
      obj.description ??
      (obj.meta as Record<string, unknown> | undefined)?.developer_message;

    if (typeof candidate === 'string') return candidate.slice(0, 300);
    if (candidate && typeof candidate === 'object') {
      const nested = (candidate as Record<string, unknown>).message;
      if (typeof nested === 'string') return nested.slice(0, 300);
    }
    try {
      return JSON.stringify(data).slice(0, 300);
    } catch {
      return '';
    }
  }

  /**
   * Timing-safe comparison of two secrets. Length is compared first because
   * `timingSafeEqual` throws on a mismatch, which would itself leak length.
   */
  protected static safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a ?? '', 'utf8');
    const bufB = Buffer.from(b ?? '', 'utf8');
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /** Timing-safe HMAC check for providers that sign the raw body. */
  protected static verifyHmac(
    rawBody: Buffer,
    secret: string,
    signature: string,
    algorithm: 'sha256' | 'sha1' = 'sha256',
    encoding: 'hex' | 'base64' = 'hex',
  ): boolean {
    if (!secret || !signature) return false;
    const expected = crypto.createHmac(algorithm, secret).update(rawBody).digest(encoding);
    return WhatsAppProvider.safeEqual(expected, signature.trim());
  }
}

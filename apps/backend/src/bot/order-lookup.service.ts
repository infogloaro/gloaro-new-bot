import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SettingsService } from '../settings/settings.service';

export interface OrderLookupResult {
  found: boolean;
  message: string;
}

/**
 * Order tracking. The requirement is: connect to the order API if one is
 * available, otherwise create a support request. Until GloAro provides an order
 * API, `bot.orderApiUrl` is blank and every lookup falls through to the support
 * request branch in the bot engine.
 */
@Injectable()
export class OrderLookupService {
  private readonly logger = new Logger(OrderLookupService.name);

  constructor(private readonly settings: SettingsService) {}

  async lookup(tenantId: string, orderId: string): Promise<OrderLookupResult> {
    const baseUrl = this.settings.get(tenantId, 'bot.orderApiUrl').trim();
    if (!baseUrl || !orderId) {
      return { found: false, message: '' };
    }

    try {
      const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(orderId)}`, {
        timeout: 8_000,
      });

      if (!data || data.found === false) return { found: false, message: '' };

      const lines = [
        `📦 *Order ${orderId}*`,
        '',
        `Status: *${data.status ?? 'In progress'}*`,
        data.placedAt ? `Placed: ${data.placedAt}` : null,
        data.expectedDelivery ? `Expected delivery: ${data.expectedDelivery}` : null,
        data.courier ? `Courier: ${data.courier}` : null,
        data.trackingNumber ? `Tracking No: ${data.trackingNumber}` : null,
        data.trackingUrl ? `\nTrack here: ${data.trackingUrl}` : null,
      ].filter(Boolean);

      return { found: true, message: lines.join('\n') };
    } catch (err) {
      // A failing order API must degrade to a support request, not an error reply.
      this.logger.warn(
        `Order lookup for ${orderId} failed: ${err instanceof Error ? err.message : err}`,
      );
      return { found: false, message: '' };
    }
  }
}

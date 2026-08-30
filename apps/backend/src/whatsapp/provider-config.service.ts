import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Prisma,
  ProviderConnectionStatus,
  WhatsAppProviderConfig,
  WhatsAppProviderType,
} from "@prisma/client";
import { AppConfig, Dialog360EnvConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_TENANT_ID } from "../tenant/tenant.constants";
import { CredentialCryptoService } from "./crypto.service";
import {
  ConnectionState,
  ConnectionTestResult,
  ProviderError,
  ResolvedProviderConfig,
  WhatsAppProviderId,
} from "./provider.types";
import { WhatsAppProvider } from "./providers/provider.base";
import {
  allDescriptors,
  createProvider,
  describeProvider,
} from "./providers/provider.registry";

/** What the admin panel is allowed to see. Credentials are masked, never raw. */
export interface SafeProviderConfig {
  id: string;
  tenantId: string;
  provider: WhatsAppProviderType;
  providerLabel: string;
  phoneNumber: string;
  label: string;
  externalId: string | null;
  /** { fieldName: masked value }. Secrets show only their last 4 characters. */
  credentials: Record<string, string>;
  webhookUrl: string;
  status: ProviderConnectionStatus;
  statusMessage: string | null;
  lastCheckedAt: Date | null;
  lastInboundAt: Date | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertProviderConfigInput {
  provider: WhatsAppProviderId;
  phoneNumber: string;
  label?: string;
  /** Only the fields the admin actually changed. Blank secrets keep the stored value. */
  credentials: Record<string, string>;
  isActive?: boolean;
}

/** Cache entry, invalidated by the row's own `updatedAt`. */
interface CachedAdapter {
  stamp: number;
  adapter: WhatsAppProvider;
}

const STATE_TO_STATUS: Record<ConnectionState, ProviderConnectionStatus> = {
  CONNECTED: ProviderConnectionStatus.CONNECTED,
  DISCONNECTED: ProviderConnectionStatus.DISCONNECTED,
  PENDING: ProviderConnectionStatus.PENDING,
  ERROR: ProviderConnectionStatus.ERROR,
};

/**
 * Owns every WhatsApp account row: validation, encryption, adapter construction
 * and connection state.
 *
 * The plaintext of a credential exists only inside this service and inside the
 * adapter it hands it to. Controllers get `SafeProviderConfig`, which is masked.
 */
@Injectable()
export class ProviderConfigService implements OnModuleInit {
  private readonly logger = new Logger(ProviderConfigService.name);
  private readonly adapters = new Map<string, CachedAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CredentialCryptoService,
    private readonly config: ConfigService,
  ) {}

  /** Provisions the Sandbox channel from env without exposing its API key to the browser. */
  async onModuleInit(): Promise<void> {
    const env = this.config.get<Dialog360EnvConfig>("dialog360");
    if (!env?.apiKey || !env.phoneNumber) return;

    await this.prisma.tenant.upsert({
      where: { id: DEFAULT_TENANT_ID },
      update: {},
      create: { id: DEFAULT_TENANT_ID, slug: "gloaro", name: "GloAro" },
    });
    const phoneNumber = ProviderConfigService.normaliseNumber(env.phoneNumber);
    const credentials = this.validateCredentials(
      "DIALOG360",
      {
        apiKey: env.apiKey,
        channelId: env.channelId,
        environment: env.environment,
      },
      {},
    );
    const existing = await this.prisma.whatsAppProviderConfig.findUnique({
      where: {
        tenantId_provider_phoneNumber: {
          tenantId: DEFAULT_TENANT_ID,
          provider: "DIALOG360",
          phoneNumber,
        },
      },
    });
    const webhookSecret = existing
      ? this.crypto.decrypt(existing.webhookSecret)
      : CredentialCryptoService.generateWebhookSecret();
    const data = {
      tenantId: DEFAULT_TENANT_ID,
      provider: "DIALOG360" as const,
      phoneNumber,
      label: "360dialog Sandbox",
      externalId: ProviderConfigService.externalIdFor("DIALOG360", credentials),
      credentials: this.crypto.encryptRecord(
        credentials,
      ) as Prisma.InputJsonValue,
      webhookSecret:
        existing?.webhookSecret ?? this.crypto.encrypt(webhookSecret),
      webhookUrl: this.buildWebhookUrl(
        "DIALOG360",
        existing?.id ?? "PENDING",
        webhookSecret,
      ),
      status: ProviderConnectionStatus.PENDING,
      statusMessage: null,
      isActive: true,
      isDefault: true,
    };

    const row = existing
      ? await this.prisma.whatsAppProviderConfig.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.whatsAppProviderConfig.create({ data });
    await this.prisma.whatsAppProviderConfig.update({
      where: { id: row.id },
      data: {
        webhookUrl: this.buildWebhookUrl("DIALOG360", row.id, webhookSecret),
      },
    });
    await this.prisma.whatsAppProviderConfig.updateMany({
      where: { tenantId: DEFAULT_TENANT_ID, id: { not: row.id } },
      data: { isDefault: false },
    });
    this.adapters.delete(row.id);
    this.logger.log(
      `Provisioned 360dialog ${env.environment} channel from environment variables`,
    );
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Provider catalogue for the admin dropdown and the dynamic config form. */
  descriptors() {
    return allDescriptors();
  }

  async findAll(tenantId: string): Promise<SafeProviderConfig[]> {
    const rows = await this.prisma.whatsAppProviderConfig.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return rows.map((row) => this.toSafe(row));
  }

  async findOne(tenantId: string, id: string): Promise<SafeProviderConfig> {
    return this.toSafe(await this.getOwnedRow(tenantId, id));
  }

  /** The account outbound messages use for a tenant, or null if none is live. */
  async activeAdapter(tenantId: string): Promise<WhatsAppProvider | null> {
    const row = await this.prisma.whatsAppProviderConfig.findFirst({
      where: { tenantId, isActive: true },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    return row ? this.adapterFor(row) : null;
  }

  /** The row behind `activeAdapter`, for message attribution. */
  activeConfig(tenantId: string) {
    return this.prisma.whatsAppProviderConfig.findFirst({
      where: { tenantId, isActive: true },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
  }

  /**
   * One specific live channel, used to answer a customer on the number they
   * wrote to. Falls back to the tenant's default if that channel has since been
   * disconnected, so an in-flight reply is not silently dropped.
   */
  async activeConfigById(tenantId: string, id: string) {
    const row = await this.prisma.whatsAppProviderConfig.findFirst({
      where: { id, tenantId, isActive: true },
    });
    return row ?? this.activeConfig(tenantId);
  }

  // -------------------------------------------------------------------------
  // Webhook routing
  // -------------------------------------------------------------------------

  /**
   * Resolves the account an inbound webhook belongs to. The callback URL we
   * hand out always carries the account id, so this is normally an exact
   * lookup; `externalId` is the fallback for a provider that mangles the path.
   */
  async routeInbound(
    provider: WhatsAppProviderId,
    accountId?: string,
    externalId?: string,
  ): Promise<WhatsAppProviderConfig | null> {
    if (accountId) {
      const row = await this.prisma.whatsAppProviderConfig.findUnique({
        where: { id: accountId },
      });
      // A mismatched provider means the URL was hand-edited; refuse it.
      return row && row.provider === provider ? row : null;
    }
    if (externalId) {
      return this.prisma.whatsAppProviderConfig.findUnique({
        where: { provider_externalId: { provider, externalId } },
      });
    }
    return null;
  }

  /** Builds (or reuses) the adapter for one stored account. */
  adapterFor(row: WhatsAppProviderConfig): WhatsAppProvider {
    const stamp = row.updatedAt.getTime();
    const cached = this.adapters.get(row.id);
    if (cached && cached.stamp === stamp) return cached.adapter;

    const adapter = createProvider(this.resolve(row));
    this.adapters.set(row.id, { stamp, adapter });
    return adapter;
  }

  /** Decrypts one row into the shape an adapter constructor takes. */
  private resolve(row: WhatsAppProviderConfig): ResolvedProviderConfig {
    const stored = (row.credentials ?? {}) as Record<string, string>;
    let credentials: Record<string, string>;
    let webhookSecret: string;

    try {
      credentials = this.crypto.decryptRecord(stored);
      webhookSecret = this.crypto.decrypt(row.webhookSecret);
    } catch {
      // Wrong or rotated key. Fail loudly rather than sending with garbage.
      throw new ProviderError(
        "NOT_CONFIGURED",
        "Stored credentials could not be decrypted - re-enter them in WhatsApp settings",
      );
    }

    return {
      tenantId: row.tenantId,
      provider: row.provider as WhatsAppProviderId,
      phoneNumber: row.phoneNumber,
      credentials,
      webhookSecret,
      webhookUrl: this.buildWebhookUrl(
        row.provider as WhatsAppProviderId,
        row.id,
        webhookSecret,
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(
    tenantId: string,
    input: UpsertProviderConfigInput,
  ): Promise<SafeProviderConfig> {
    const descriptor = describeProvider(input.provider);
    const phoneNumber = ProviderConfigService.normaliseNumber(
      input.phoneNumber,
    );
    const credentials = this.validateCredentials(
      input.provider,
      input.credentials,
      {},
    );

    const duplicate = await this.prisma.whatsAppProviderConfig.findUnique({
      where: {
        tenantId_provider_phoneNumber: {
          tenantId,
          provider: input.provider,
          phoneNumber,
        },
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        `${descriptor.label} is already configured for ${phoneNumber} on this workspace`,
      );
    }

    const webhookSecret = CredentialCryptoService.generateWebhookSecret();
    const isFirst =
      (await this.prisma.whatsAppProviderConfig.count({
        where: { tenantId },
      })) === 0;

    const row = await this.prisma.whatsAppProviderConfig.create({
      data: {
        tenantId,
        provider: input.provider,
        phoneNumber,
        label: input.label?.trim() || descriptor.label,
        externalId: ProviderConfigService.externalIdFor(
          input.provider,
          credentials,
        ),
        credentials: this.crypto.encryptRecord(
          credentials,
        ) as Prisma.InputJsonValue,
        webhookSecret: this.crypto.encrypt(webhookSecret),
        // Stored without the secret so the column is safe to read anywhere.
        webhookUrl: this.buildWebhookUrl(input.provider, "PENDING", ""),
        isActive: input.isActive ?? false,
        isDefault: isFirst,
        status: ProviderConnectionStatus.PENDING,
      },
    });

    // The id is only known after the insert, so the URL is written back now.
    const finalRow = await this.prisma.whatsAppProviderConfig.update({
      where: { id: row.id },
      data: { webhookUrl: this.buildWebhookUrl(input.provider, row.id, "") },
    });

    this.logger.log(
      `Tenant ${tenantId} configured ${descriptor.label} for ${ProviderConfigService.maskNumber(phoneNumber)}`,
    );
    return this.toSafe(finalRow);
  }

  async update(
    tenantId: string,
    id: string,
    input: Partial<UpsertProviderConfigInput>,
  ): Promise<SafeProviderConfig> {
    const existing = await this.getOwnedRow(tenantId, id);
    const provider = existing.provider as WhatsAppProviderId;

    const current = this.crypto.decryptRecord(
      (existing.credentials ?? {}) as Record<string, string>,
    );
    const credentials = input.credentials
      ? this.validateCredentials(provider, input.credentials, current)
      : current;

    const row = await this.prisma.whatsAppProviderConfig.update({
      where: { id },
      data: {
        ...(input.phoneNumber
          ? {
              phoneNumber: ProviderConfigService.normaliseNumber(
                input.phoneNumber,
              ),
            }
          : {}),
        ...(input.label !== undefined
          ? { label: input.label.trim() || describeProvider(provider).label }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        credentials: this.crypto.encryptRecord(
          credentials,
        ) as Prisma.InputJsonValue,
        externalId: ProviderConfigService.externalIdFor(provider, credentials),
        // Any credential change invalidates the last connection verdict.
        ...(input.credentials
          ? {
              status: ProviderConnectionStatus.PENDING,
              statusMessage: null,
              lastCheckedAt: null,
            }
          : {}),
      },
    });

    this.adapters.delete(id);
    return this.toSafe(row);
  }

  async remove(tenantId: string, id: string): Promise<{ deleted: true }> {
    await this.getOwnedRow(tenantId, id);
    await this.prisma.whatsAppProviderConfig.delete({ where: { id } });
    this.adapters.delete(id);
    return { deleted: true };
  }

  /** Makes one account the tenant's outbound channel. */
  async makeDefault(tenantId: string, id: string): Promise<SafeProviderConfig> {
    await this.getOwnedRow(tenantId, id);
    const [, row] = await this.prisma.$transaction([
      this.prisma.whatsAppProviderConfig.updateMany({
        where: { tenantId, id: { not: id } },
        data: { isDefault: false },
      }),
      this.prisma.whatsAppProviderConfig.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
    return this.toSafe(row);
  }

  // -------------------------------------------------------------------------
  // Connection management (Connect / Test / Disconnect / Enable / Disable)
  // -------------------------------------------------------------------------

  /** Runs the provider's own check and records the verdict on the row. */
  async testConnection(
    tenantId: string,
    id: string,
  ): Promise<ConnectionTestResult> {
    const row = await this.getOwnedRow(tenantId, id);

    let result: ConnectionTestResult;
    try {
      result = await this.adapterFor(row).testConnection();
    } catch (err) {
      result = {
        state: "ERROR",
        message:
          err instanceof ProviderError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Connection test failed",
      };
    }

    await this.recordStatus(id, result);
    return result;
  }

  /** Test, and switch the channel on if it passed. */
  async connect(tenantId: string, id: string): Promise<ConnectionTestResult> {
    const result = await this.testConnection(tenantId, id);
    if (result.state === "CONNECTED" || result.state === "PENDING") {
      await this.prisma.whatsAppProviderConfig.update({
        where: { id },
        data: { isActive: true },
      });
      this.adapters.delete(id);
    }
    return result;
  }

  /** Stops the bot on this channel without discarding the credentials. */
  async disconnect(tenantId: string, id: string): Promise<SafeProviderConfig> {
    await this.getOwnedRow(tenantId, id);
    const row = await this.prisma.whatsAppProviderConfig.update({
      where: { id },
      data: {
        isActive: false,
        status: ProviderConnectionStatus.DISCONNECTED,
        statusMessage: "Disconnected from the admin panel",
      },
    });
    this.adapters.delete(id);
    return this.toSafe(row);
  }

  async setEnabled(
    tenantId: string,
    id: string,
    isActive: boolean,
  ): Promise<SafeProviderConfig> {
    await this.getOwnedRow(tenantId, id);
    const row = await this.prisma.whatsAppProviderConfig.update({
      where: { id },
      data: { isActive },
    });
    this.adapters.delete(id);
    return this.toSafe(row);
  }

  /** Records a send failure against the channel so the admin sees it. */
  async noteSendFailure(id: string, message: string): Promise<void> {
    await this.prisma.whatsAppProviderConfig
      .update({
        where: { id },
        data: {
          status: ProviderConnectionStatus.ERROR,
          statusMessage: message.slice(0, 500),
          lastCheckedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  async noteInbound(id: string): Promise<void> {
    await this.prisma.whatsAppProviderConfig
      .update({ where: { id }, data: { lastInboundAt: new Date() } })
      .catch(() => undefined);
  }

  private async recordStatus(
    id: string,
    result: ConnectionTestResult,
  ): Promise<void> {
    await this.prisma.whatsAppProviderConfig.update({
      where: { id },
      data: {
        status: STATE_TO_STATUS[result.state],
        statusMessage: result.message.slice(0, 500),
        lastCheckedAt: new Date(),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Every read and write goes through this, so a wrong tenant is a 404. */
  private async getOwnedRow(
    tenantId: string,
    id: string,
  ): Promise<WhatsAppProviderConfig> {
    const row = await this.prisma.whatsAppProviderConfig.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException("WhatsApp account not found");
    return row;
  }

  /**
   * Checks the submitted fields against the provider's descriptor and merges
   * them over what is already stored, so a blank secret field means "keep the
   * existing value" rather than "erase it".
   */
  private validateCredentials(
    provider: WhatsAppProviderId,
    submitted: Record<string, string>,
    current: Record<string, string>,
  ): Record<string, string> {
    const descriptor = describeProvider(provider);
    const known = new Set(descriptor.fields.map((f) => f.name));

    const unknown = Object.keys(submitted).filter((k) => !known.has(k));
    if (unknown.length) {
      throw new BadRequestException(
        `${descriptor.label} does not accept: ${unknown.join(", ")}`,
      );
    }

    const merged: Record<string, string> = {};
    for (const field of descriptor.fields) {
      const incoming = submitted[field.name];
      const value =
        incoming === undefined ||
        (field.type === "secret" && incoming.trim() === "")
          ? (current[field.name] ?? "")
          : incoming.trim();

      if (field.required && !value) {
        throw new BadRequestException(
          `${field.label} is required for ${descriptor.label}`,
        );
      }
      if (
        field.type === "select" &&
        value &&
        !field.options?.some((o) => o.value === value)
      ) {
        throw new BadRequestException(
          `${field.label} must be one of the offered options`,
        );
      }
      merged[field.name] = value;
    }
    return merged;
  }

  /**
   * The URL the client pastes into the provider's dashboard. The account id
   * makes routing exact; the token authenticates the request for the providers
   * that do not sign their callbacks.
   */
  private buildWebhookUrl(
    provider: WhatsAppProviderId,
    accountId: string,
    secret: string,
  ): string {
    const appUrl = (this.config.get<AppConfig>("app")!.appUrl ?? "").replace(
      /\/+$/,
      "",
    );
    const slug = describeProvider(provider).slug;
    const base = `${appUrl}/webhooks/whatsapp/${slug}/${accountId}`;
    return secret ? `${base}?token=${secret}` : base;
  }

  /** The full callback URL including the secret. Only ever shown to an admin. */
  async revealWebhookUrl(
    tenantId: string,
    id: string,
  ): Promise<{ webhookUrl: string }> {
    const row = await this.getOwnedRow(tenantId, id);
    return {
      webhookUrl: this.buildWebhookUrl(
        row.provider as WhatsAppProviderId,
        row.id,
        this.crypto.decrypt(row.webhookSecret),
      ),
    };
  }

  /** Rotates the webhook secret; the client must re-paste the URL afterwards. */
  async rotateWebhookSecret(
    tenantId: string,
    id: string,
  ): Promise<{ webhookUrl: string }> {
    const row = await this.getOwnedRow(tenantId, id);
    const secret = CredentialCryptoService.generateWebhookSecret();
    await this.prisma.whatsAppProviderConfig.update({
      where: { id },
      data: {
        webhookSecret: this.crypto.encrypt(secret),
        status: ProviderConnectionStatus.PENDING,
        statusMessage: "Webhook secret rotated - re-register the callback URL",
      },
    });
    this.adapters.delete(id);
    return {
      webhookUrl: this.buildWebhookUrl(
        row.provider as WhatsAppProviderId,
        id,
        secret,
      ),
    };
  }

  /** The provider-side id used as a webhook routing fallback. */
  private static externalIdFor(
    provider: WhatsAppProviderId,
    credentials: Record<string, string>,
  ): string | null {
    const value =
      provider === "ULTRAMSG"
        ? credentials.instanceId
        : provider === "GUPSHUP"
          ? credentials.appName
          : provider === "DIALOG360"
            ? credentials.channelId
            : credentials.projectId;
    return value?.trim() || null;
  }

  private static normaliseNumber(value: string): string {
    const digits = (value ?? "").replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      throw new BadRequestException(
        "WhatsApp number must be in international format, digits only (e.g. 919876543210)",
      );
    }
    return digits;
  }

  /** For logs: never write a full customer or business number to disk. */
  static maskNumber(value: string): string {
    return value.length <= 4
      ? "****"
      : `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  }

  /** Row -> what the browser is allowed to receive. */
  private toSafe(row: WhatsAppProviderConfig): SafeProviderConfig {
    const descriptor = describeProvider(row.provider as WhatsAppProviderId);
    const stored = (row.credentials ?? {}) as Record<string, string>;

    const credentials: Record<string, string> = {};
    for (const field of descriptor.fields) {
      let plain = "";
      try {
        plain = this.crypto.decrypt(stored[field.name] ?? "");
      } catch {
        // Undecryptable value: show it as unset rather than leaking ciphertext.
        plain = "";
      }
      // Non-secret fields (instance id, app name, mode) are shown so the admin
      // can see what is configured; secrets never leave the server intact.
      credentials[field.name] =
        field.type === "secret" ? CredentialCryptoService.mask(plain) : plain;
    }

    return {
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      providerLabel: descriptor.label,
      phoneNumber: row.phoneNumber,
      label: row.label,
      externalId: row.externalId,
      credentials,
      webhookUrl: row.webhookUrl,
      status: row.status,
      statusMessage: row.statusMessage,
      lastCheckedAt: row.lastCheckedAt,
      lastInboundAt: row.lastInboundAt,
      isActive: row.isActive,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

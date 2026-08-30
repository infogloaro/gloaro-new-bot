/**
 * Typed view over process.env. Every module reads config through this so that
 * moving to AWS Secrets Manager later is a change in one place.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  appUrl: string;
  corsOrigins: string[];
}

/** `expiresIn` matches jsonwebtoken's own type, e.g. '15m' | '7d' | 900. */
export type ExpiresIn = `${number}${"s" | "m" | "h" | "d"}` | number;

export interface JwtConfig {
  secret: string;
  expiresIn: ExpiresIn;
  refreshSecret: string;
  refreshExpiresIn: ExpiresIn;
}

/**
 * WhatsApp credentials are NOT here any more. They are per tenant, encrypted in
 * `whatsapp_provider_configs`, and configured from Admin → Settings → WhatsApp.
 * The only WhatsApp-related environment value left is the key those credentials
 * are encrypted with.
 */
export interface SecurityConfig {
  /** 64 hex characters, or any passphrase of 32+ characters. */
  encryptionKey: string;
}

export interface SheetsConfig {
  enabled: boolean;
  sheetId: string;
  tab: string;
  keyFile: string;
  inlineJson: string;
}

export interface Dialog360EnvConfig {
  apiKey: string;
  phoneNumber: string;
  channelId: string;
  environment: "sandbox" | "production";
}

const toBool = (v: string | undefined, fallback = false): boolean =>
  v === undefined || v === ""
    ? fallback
    : ["1", "true", "yes", "on"].includes(v.toLowerCase());

export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: parseInt(process.env.PORT ?? "3000", 10),
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  } satisfies AppConfig,

  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6380", 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? "dev_secret_change_me",
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "15m") as ExpiresIn,
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ?? "dev_refresh_secret_change_me",
    refreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? "7d") as ExpiresIn,
  } satisfies JwtConfig,

  security: {
    encryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY ?? "",
  } satisfies SecurityConfig,

  sheets: {
    enabled: toBool(process.env.GOOGLE_SHEETS_ENABLED),
    sheetId: process.env.GOOGLE_SHEET_ID ?? "",
    tab: process.env.GOOGLE_SHEET_TAB ?? "Leads",
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ?? "",
    inlineJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
  } satisfies SheetsConfig,

  dialog360: {
    apiKey: process.env.DIALOG360_API_KEY ?? "",
    phoneNumber: process.env.DIALOG360_PHONE_NUMBER ?? "",
    channelId: process.env.DIALOG360_CHANNEL_ID ?? "",
    environment:
      process.env.DIALOG360_ENVIRONMENT === "production"
        ? "production"
        : "sandbox",
  } satisfies Dialog360EnvConfig,

  bot: {
    sessionTimeoutMinutes: parseInt(
      process.env.BOT_SESSION_TIMEOUT_MINUTES ?? "30",
      10,
    ),
  },

  seed: {
    adminEmail: process.env.ADMIN_EMAIL ?? "admin@gloaro.com",
    adminPassword: process.env.ADMIN_PASSWORD ?? "ChangeMe@123",
    adminName: process.env.ADMIN_NAME ?? "GloAro Admin",
  },
});

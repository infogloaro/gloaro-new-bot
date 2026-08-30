import * as Joi from "joi";

/**
 * Fails startup on a missing/invalid env var rather than at the first request.
 * Fields only needed once WhatsApp or Sheets are switched on are required
 * conditionally on their own *_ENABLED flag.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  PORT: Joi.number().default(3000),
  APP_URL: Joi.string().uri().default("http://localhost:3000"),
  CORS_ORIGINS: Joi.string().default("http://localhost:5173"),

  DATABASE_URL: Joi.string().required(),

  REDIS_HOST: Joi.string().default("localhost"),
  REDIS_PORT: Joi.number().default(6380),
  REDIS_PASSWORD: Joi.string().allow("").optional(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default("15m"),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default("7d"),

  ADMIN_EMAIL: Joi.string().email().default("admin@gloaro.com"),
  ADMIN_PASSWORD: Joi.string().default("ChangeMe@123"),
  ADMIN_NAME: Joi.string().default("GloAro Admin"),

  // WhatsApp provider credentials are per tenant and live encrypted in the
  // database, not here. This is the key they are encrypted with: 64 hex
  // characters, or any passphrase of 32+ characters. Required in production so
  // a deployment cannot silently fall back to the development-only key.
  CREDENTIALS_ENCRYPTION_KEY: Joi.string()
    .allow("")
    .when("NODE_ENV", {
      is: "production",
      then: Joi.string().min(32).required().disallow(""),
    }),

  GOOGLE_SHEETS_ENABLED: Joi.string().default("false"),
  GOOGLE_SHEET_ID: Joi.string()
    .allow("")
    .when("GOOGLE_SHEETS_ENABLED", {
      is: Joi.string().valid("true", "1", "yes", "on"),
      then: Joi.string().required().disallow(""),
    }),
  GOOGLE_SHEET_TAB: Joi.string().default("Leads"),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: Joi.string().allow("").optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: Joi.string().allow("").optional(),

  DIALOG360_API_KEY: Joi.string().allow("").optional(),
  DIALOG360_PHONE_NUMBER: Joi.string()
    .allow("")
    .when("DIALOG360_API_KEY", {
      is: Joi.string().min(1),
      then: Joi.string().required().disallow(""),
    }),
  DIALOG360_CHANNEL_ID: Joi.string().allow("").optional(),
  DIALOG360_ENVIRONMENT: Joi.string()
    .valid("sandbox", "production")
    .default("sandbox"),

  BOT_SESSION_TIMEOUT_MINUTES: Joi.number().default(30),
});

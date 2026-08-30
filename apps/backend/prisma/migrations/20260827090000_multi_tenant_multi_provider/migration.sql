-- Multi-tenant + multi-provider migration.
--
-- Hand written rather than generated, because every existing row has to be
-- adopted by a tenant before `tenant_id` can be made NOT NULL. All existing
-- data is assigned to the seeded "gloaro" tenant, so the running bot keeps
-- working exactly as before.

-- ---------------------------------------------------------------------------
-- 1. New enums
-- ---------------------------------------------------------------------------

CREATE TYPE "WhatsAppProviderType" AS ENUM ('ULTRAMSG', 'GUPSHUP', 'AISENSY', 'DIALOG360');
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');
ALTER TYPE "WebhookEventStatus" ADD VALUE IF NOT EXISTS 'UNROUTED';

-- ---------------------------------------------------------------------------
-- 2. Tenants
-- ---------------------------------------------------------------------------

CREATE TABLE "tenants" (
    "id"         UUID NOT NULL,
    "slug"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "is_active"  BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- The tenant every pre-existing row is adopted by. The fixed id lets the
-- seed script and this migration agree without a lookup.
INSERT INTO "tenants" ("id", "slug", "name", "is_active", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'gloaro', 'GloAro', true, NOW(), NOW());

-- ---------------------------------------------------------------------------
-- 3. tenant_id on every owned table (add nullable -> backfill -> enforce)
-- ---------------------------------------------------------------------------

ALTER TABLE "users"          ADD COLUMN "tenant_id" UUID;
ALTER TABLE "customers"      ADD COLUMN "tenant_id" UUID;
ALTER TABLE "leads"          ADD COLUMN "tenant_id" UUID;
ALTER TABLE "conversations"  ADD COLUMN "tenant_id" UUID;
ALTER TABLE "messages"       ADD COLUMN "tenant_id" UUID;
ALTER TABLE "bot_flows"      ADD COLUMN "tenant_id" UUID;
ALTER TABLE "bot_sessions"   ADD COLUMN "tenant_id" UUID;
ALTER TABLE "settings"       ADD COLUMN "tenant_id" UUID;
ALTER TABLE "webhook_events" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "lead_counters"  ADD COLUMN "tenant_id" UUID;

UPDATE "customers"     SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
UPDATE "leads"         SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
UPDATE "conversations" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
UPDATE "messages"      SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
UPDATE "bot_flows"     SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
UPDATE "bot_sessions"  SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
UPDATE "settings"      SET "tenant_id" = '00000000-0000-0000-0000-000000000001';
UPDATE "lead_counters" SET "tenant_id" = '00000000-0000-0000-0000-000000000001';

-- SUPER_ADMIN stays platform-wide (NULL); every other role is pinned to a tenant.
UPDATE "users" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "role" <> 'SUPER_ADMIN';

ALTER TABLE "customers"     ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "leads"         ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "messages"      ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "bot_flows"     ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "bot_sessions"  ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "settings"      ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "lead_counters" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "users"          ADD CONSTRAINT "users_tenant_id_fkey"          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers"      ADD CONSTRAINT "customers_tenant_id_fkey"      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads"          ADD CONSTRAINT "leads_tenant_id_fkey"          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations"  ADD CONSTRAINT "conversations_tenant_id_fkey"  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages"       ADD CONSTRAINT "messages_tenant_id_fkey"       FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_flows"      ADD CONSTRAINT "bot_flows_tenant_id_fkey"      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_sessions"   ADD CONSTRAINT "bot_sessions_tenant_id_fkey"   FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settings"       ADD CONSTRAINT "settings_tenant_id_fkey"       FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_counters"  ADD CONSTRAINT "lead_counters_tenant_id_fkey"  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Global uniqueness becomes tenant-scoped
-- ---------------------------------------------------------------------------

DROP INDEX "customers_whatsapp_number_key";
CREATE UNIQUE INDEX "customers_tenant_id_whatsapp_number_key" ON "customers"("tenant_id", "whatsapp_number");

DROP INDEX "leads_lead_ref_key";
CREATE UNIQUE INDEX "leads_tenant_id_lead_ref_key" ON "leads"("tenant_id", "lead_ref");

DROP INDEX "bot_flows_key_key";
CREATE UNIQUE INDEX "bot_flows_tenant_id_key_key" ON "bot_flows"("tenant_id", "key");

DROP INDEX "settings_key_key";
CREATE UNIQUE INDEX "settings_tenant_id_key_key" ON "settings"("tenant_id", "key");

-- ---------------------------------------------------------------------------
-- 5. lead_counters: primary key becomes (tenant, year)
-- ---------------------------------------------------------------------------

ALTER TABLE "lead_counters" DROP CONSTRAINT "lead_counters_pkey";
ALTER TABLE "lead_counters" ADD CONSTRAINT "lead_counters_pkey" PRIMARY KEY ("tenant_id", "year");

-- ---------------------------------------------------------------------------
-- 6. messages: provider attribution
-- ---------------------------------------------------------------------------

DROP INDEX "messages_whatsapp_message_id_key";
ALTER TABLE "messages" RENAME COLUMN "whatsapp_message_id" TO "provider_message_id";
ALTER TABLE "messages" ADD COLUMN "provider" "WhatsAppProviderType";
ALTER TABLE "messages" ADD COLUMN "provider_config_id" UUID;

-- Pre-existing rows came from the retired Meta client and have no provider, so
-- the composite key leaves them alone (NULL never collides in Postgres).
CREATE UNIQUE INDEX "messages_provider_provider_message_id_key"
    ON "messages"("provider", "provider_message_id");

-- ---------------------------------------------------------------------------
-- 7. webhook_events: provider attribution
-- ---------------------------------------------------------------------------

-- This table is a pure idempotency/forensics log for a gateway that is being
-- retired, and its rows have no value under the new provider enum.
DELETE FROM "webhook_events";

DROP INDEX "webhook_events_whatsapp_message_id_key";
ALTER TABLE "webhook_events" RENAME COLUMN "whatsapp_message_id" TO "provider_message_id";
ALTER TABLE "webhook_events" ADD COLUMN "provider" "WhatsAppProviderType" NOT NULL;

CREATE UNIQUE INDEX "webhook_events_provider_provider_message_id_key"
    ON "webhook_events"("provider", "provider_message_id");

-- ---------------------------------------------------------------------------
-- 8. WhatsApp channel configuration replaces the unused Meta account table
-- ---------------------------------------------------------------------------

DROP TABLE "whatsapp_accounts";

CREATE TABLE "whatsapp_provider_configs" (
    "id"              UUID NOT NULL,
    "tenant_id"       UUID NOT NULL,
    "provider"        "WhatsAppProviderType" NOT NULL,
    "phone_number"    TEXT NOT NULL,
    "label"           TEXT NOT NULL DEFAULT 'WhatsApp',
    "external_id"     TEXT,
    "credentials"     JSONB NOT NULL DEFAULT '{}',
    "webhook_secret"  TEXT NOT NULL,
    "webhook_url"     TEXT NOT NULL,
    "status"          "ProviderConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "status_message"  TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "is_active"       BOOLEAN NOT NULL DEFAULT false,
    "is_default"      BOOLEAN NOT NULL DEFAULT false,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_provider_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_provider_configs_tenant_id_provider_phone_number_key"
    ON "whatsapp_provider_configs"("tenant_id", "provider", "phone_number");
CREATE UNIQUE INDEX "whatsapp_provider_configs_provider_external_id_key"
    ON "whatsapp_provider_configs"("provider", "external_id");
CREATE INDEX "whatsapp_provider_configs_tenant_id_is_active_idx"
    ON "whatsapp_provider_configs"("tenant_id", "is_active");
CREATE INDEX "whatsapp_provider_configs_phone_number_idx"
    ON "whatsapp_provider_configs"("phone_number");

ALTER TABLE "whatsapp_provider_configs"
    ADD CONSTRAINT "whatsapp_provider_configs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_provider_config_id_fkey"
    FOREIGN KEY ("provider_config_id") REFERENCES "whatsapp_provider_configs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 9. Tenant-scoped indexes for the admin list screens
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "customers_last_interaction_at_idx";
DROP INDEX IF EXISTS "leads_status_idx";
DROP INDEX IF EXISTS "leads_created_at_idx";
DROP INDEX IF EXISTS "leads_whatsapp_number_idx";
DROP INDEX IF EXISTS "conversations_status_idx";
DROP INDEX IF EXISTS "conversations_last_message_at_idx";
DROP INDEX IF EXISTS "bot_flows_is_active_idx";
DROP INDEX IF EXISTS "settings_group_idx";
DROP INDEX IF EXISTS "webhook_events_created_at_idx";

CREATE INDEX "users_tenant_id_idx"                    ON "users"("tenant_id");
CREATE INDEX "customers_tenant_id_last_interaction_at_idx" ON "customers"("tenant_id", "last_interaction_at");
CREATE INDEX "leads_tenant_id_status_idx"             ON "leads"("tenant_id", "status");
CREATE INDEX "leads_tenant_id_created_at_idx"         ON "leads"("tenant_id", "created_at");
CREATE INDEX "leads_tenant_id_whatsapp_number_idx"    ON "leads"("tenant_id", "whatsapp_number");
CREATE INDEX "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at");
CREATE INDEX "conversations_tenant_id_status_idx"     ON "conversations"("tenant_id", "status");
CREATE INDEX "messages_tenant_id_created_at_idx"      ON "messages"("tenant_id", "created_at");
CREATE INDEX "bot_flows_tenant_id_is_active_idx"      ON "bot_flows"("tenant_id", "is_active");
CREATE INDEX "bot_sessions_tenant_id_idx"             ON "bot_sessions"("tenant_id");
CREATE INDEX "settings_tenant_id_group_idx"           ON "settings"("tenant_id", "group");
CREATE INDEX "webhook_events_tenant_id_created_at_idx" ON "webhook_events"("tenant_id", "created_at");

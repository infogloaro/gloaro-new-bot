-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'FOLLOW_UP', 'CLOSED');

-- CreateEnum
CREATE TYPE "MainCategory" AS ENUM ('GLOARO_MART', 'DIGITAL_NETWORK');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'IDLE', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "profile_name" TEXT,
    "name" TEXT,
    "email" TEXT,
    "business_name" TEXT,
    "business_category" TEXT,
    "city" TEXT,
    "last_interaction_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "lead_ref" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "business_name" TEXT,
    "main_category" "MainCategory" NOT NULL,
    "sub_category" TEXT NOT NULL,
    "product_category" TEXT,
    "city" TEXT,
    "requirement" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "assigned_to" UUID,
    "raw_answers" JSONB,
    "sheet_sync_status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "sheet_synced_at" TIMESTAMP(3),
    "sheet_sync_error" TEXT,
    "sheet_row_number" INTEGER,
    "notify_sync_status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "notified_at" TIMESTAMP(3),
    "notify_error" TEXT,
    "conversation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "agent_id" UUID,
    "is_handed_over" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "whatsapp_message_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "payload" JSONB,
    "bot_node" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_flows" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "image_url" TEXT,
    "link_url" TEXT,
    "options" JSONB,
    "field_name" TEXT,
    "field_type" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "next_key" TEXT,
    "action" TEXT,
    "main_category" "MainCategory",
    "sub_category" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_sessions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "current_node" TEXT NOT NULL DEFAULT 'WELCOME',
    "data" JSONB NOT NULL DEFAULT '{}',
    "history" JSONB NOT NULL DEFAULT '[]',
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "display_number" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "business_account_id" TEXT NOT NULL,
    "access_token" TEXT,
    "verify_token" TEXT,
    "api_version" TEXT NOT NULL DEFAULT 'v23.0',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'company',
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'string',
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "whatsapp_message_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL DEFAULT 'message',
    "from_number" TEXT,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_counters" (
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lead_counters_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_whatsapp_number_key" ON "customers"("whatsapp_number");

-- CreateIndex
CREATE INDEX "customers_last_interaction_at_idx" ON "customers"("last_interaction_at");

-- CreateIndex
CREATE UNIQUE INDEX "leads_lead_ref_key" ON "leads"("lead_ref");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_main_category_sub_category_idx" ON "leads"("main_category", "sub_category");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "leads_whatsapp_number_idx" ON "leads"("whatsapp_number");

-- CreateIndex
CREATE INDEX "leads_sheet_sync_status_idx" ON "leads"("sheet_sync_status");

-- CreateIndex
CREATE INDEX "lead_notes_lead_id_idx" ON "lead_notes"("lead_id");

-- CreateIndex
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

-- CreateIndex
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_whatsapp_message_id_key" ON "messages"("whatsapp_message_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_customer_id_idx" ON "messages"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_flows_key_key" ON "bot_flows"("key");

-- CreateIndex
CREATE INDEX "bot_flows_is_active_idx" ON "bot_flows"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "bot_sessions_customer_id_key" ON "bot_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "bot_sessions_expires_at_idx" ON "bot_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_phone_number_id_key" ON "whatsapp_accounts"("phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "settings_group_idx" ON "settings"("group");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_whatsapp_message_id_key" ON "webhook_events"("whatsapp_message_id");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

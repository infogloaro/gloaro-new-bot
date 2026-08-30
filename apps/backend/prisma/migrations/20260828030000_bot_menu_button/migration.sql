-- Label on the button that opens a MENU node's tappable WhatsApp list.
-- Nullable: a node without one falls back to a default label, and the numbered
-- text rendering ignores it entirely.
ALTER TABLE "bot_flows" ADD COLUMN "menu_button" TEXT;

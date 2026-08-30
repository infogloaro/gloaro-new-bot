import { FlowOption } from './flow-definition';

/**
 * Turns one MENU node's options into either a tappable WhatsApp List or the
 * numbered text that has always worked.
 *
 * Both renderings come from the same `options` array, so a menu can never drift
 * between the two. Which one is actually sent is decided per message by the
 * channel's capabilities - see `BotService.deliver`.
 */

/** WhatsApp's own limits on interactive List Messages. */
export const MENU_LIMITS = {
  /** Rows across all sections. */
  rows: 10,
  rowTitle: 24,
  rowDescription: 72,
  /** Label on the button that opens the list. */
  button: 20,
  body: 1024,
  footer: 60,
} as const;

/** A tappable menu the engine wants rendered. */
export interface OutboundMenu {
  /** Label on the button that opens the list, e.g. "Choose an option". */
  buttonText: string;
  items: Array<{ id: string; title: string; description?: string }>;
}

const DEFAULT_BUTTON_TEXT = 'Choose an option';

/** Digit keys rendered as the keycap emoji used throughout the flow copy. */
const KEYCAPS: Record<string, string> = {
  '1': '1️⃣',
  '2': '2️⃣',
  '3': '3️⃣',
  '4': '4️⃣',
  '5': '5️⃣',
  '6': '6️⃣',
  '7': '7️⃣',
  '8': '8️⃣',
  '9': '9️⃣',
  '0': '0️⃣',
};

function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The row title, emoji included.
 *
 * WhatsApp counts the emoji against the 24-character limit, so an explicit
 * `menuTitle` is honoured first - that is the escape hatch for a long label
 * that would otherwise be cut mid-word.
 */
export function rowTitle(option: FlowOption): string {
  const base = option.menuTitle?.trim() || option.label;
  const withIcon = option.emoji ? `${option.emoji} ${base}` : base;
  return clip(withIcon, MENU_LIMITS.rowTitle);
}

/**
 * Builds the tappable menu. Returns null when the options cannot be expressed
 * as a List - more than ten rows, or none at all - so the caller falls back to
 * text rather than sending something WhatsApp will reject.
 */
export function buildMenu(options: FlowOption[], buttonText?: string): OutboundMenu | null {
  if (!options.length || options.length > MENU_LIMITS.rows) return null;

  return {
    buttonText: clip(buttonText?.trim() || DEFAULT_BUTTON_TEXT, MENU_LIMITS.button),
    items: options.map((option) => ({
      // The option key comes straight back as `replyId` when the row is tapped,
      // which is what lets a tap and a typed "1" resolve identically.
      id: option.key,
      title: rowTitle(option),
      ...(option.description
        ? { description: clip(option.description, MENU_LIMITS.rowDescription) }
        : {}),
    })),
  };
}

/**
 * The numbered fallback, appended to the node body.
 *
 * Used whenever the channel cannot send interactive messages (UltraMsg), or the
 * tenant has chosen numbered menus. Generated rather than stored, so editing an
 * option in the admin panel updates both renderings at once.
 */
export function renderNumberedOptions(options: FlowOption[]): string {
  if (!options.length) return '';

  const lines = options.map((option) => {
    const bullet = KEYCAPS[option.key] ?? `*${option.key}*`;
    const icon = option.emoji ? `${option.emoji} ` : '';
    const detail = option.description ? ` – ${option.description}` : '';
    return `${bullet} ${icon}${option.label}${detail}`;
  });

  const prompt =
    options.length === 1
      ? `\n\nReply *${options[0].key}* to continue.`
      : '\n\nReply with the option number.';

  return `\n\n${lines.join('\n')}${prompt}`;
}

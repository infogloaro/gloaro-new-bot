import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns';
import type { LeadStatus, MainCategory, SyncStatus } from './types';

/** Renders a stored digits-only number as +91 98765 43210. */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '—';
  const clean = digits.replace(/[^\d]/g, '');
  if (clean.length === 12 && clean.startsWith('91')) {
    const core = clean.slice(2);
    return `+91 ${core.slice(0, 5)} ${core.slice(5)}`;
  }
  return `+${clean}`;
}

export function formatDateTime(iso: string): string {
  return format(parseISO(iso), 'dd MMM yyyy, h:mm a');
}

/** "2:15 PM" today, "Yesterday" yesterday, otherwise the date. */
export function formatSmartDate(iso: string): string {
  const date = parseISO(iso);
  if (isToday(date)) return format(date, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'dd MMM yyyy');
}

export function formatRelative(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}

/** B2B_MARKETPLACE -> B2b Marketplace, but keeps known acronyms uppercase. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((word) => {
      if (['b2b', 'b2c'].includes(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export const MAIN_CATEGORY_LABEL: Record<MainCategory, string> = {
  GLOARO_MART: 'GloAro Mart',
  DIGITAL_NETWORK: 'Digital Network',
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'New',
  FOLLOW_UP: 'Follow-up',
  CLOSED: 'Closed',
};

export const LEAD_STATUS_CLASS: Record<LeadStatus, string> = {
  NEW: 'bg-blue-100 text-blue-700 ring-blue-600/20',
  FOLLOW_UP: 'bg-amber-100 text-amber-700 ring-amber-600/20',
  CLOSED: 'bg-slate-200 text-slate-600 ring-slate-500/20',
};

export const SYNC_STATUS_CLASS: Record<SyncStatus, string> = {
  SYNCED: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20',
  PENDING: 'bg-amber-100 text-amber-700 ring-amber-600/20',
  FAILED: 'bg-red-100 text-red-700 ring-red-600/20',
  SKIPPED: 'bg-slate-200 text-slate-500 ring-slate-500/20',
};

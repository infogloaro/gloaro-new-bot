/**
 * Both side effects of a new lead (Google Sheets append, admin WhatsApp
 * notification) run on queues rather than inline, so that a Sheets outage or a
 * Meta hiccup can never delay the webhook response or lose a lead.
 */
export const QUEUE_SHEETS = 'sheets-sync';
export const QUEUE_NOTIFY = 'admin-notify';

export const JOB_APPEND_LEAD = 'append-lead';
export const JOB_UPDATE_LEAD_STATUS = 'update-lead-status';
export const JOB_NOTIFY_NEW_LEAD = 'notify-new-lead';

export interface AppendLeadJob {
  leadId: string;
}

export interface UpdateLeadStatusJob {
  leadId: string;
}

export interface NotifyNewLeadJob {
  leadId: string;
}

/** Retry with backoff; after this many attempts the lead is marked FAILED for manual retry. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
};

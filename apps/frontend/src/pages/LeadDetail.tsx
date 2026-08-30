import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { Lead, LeadStatus } from '@/lib/types';
import {
  LEAD_STATUS_CLASS,
  LEAD_STATUS_LABEL,
  MAIN_CATEGORY_LABEL,
  SYNC_STATUS_CLASS,
  formatDateTime,
  formatPhone,
  formatRelative,
  humanise,
} from '@/lib/format';
import { Badge, Button, Card, ErrorState, PageHeader, Select, Spinner } from '@/components/ui';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{value || '—'}</dd>
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['lead', id],
    queryFn: async () => (await api.get<Lead>(`/leads/${id}`)).data,
    enabled: !!id,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['lead', id] });
    void queryClient.invalidateQueries({ queryKey: ['leads'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const updateStatus = useMutation({
    mutationFn: (status: LeadStatus) => api.patch(`/leads/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: (err) => setError(errorMessage(err)),
  });

  const addNote = useMutation({
    mutationFn: (body: string) => api.post(`/leads/${id}/notes`, { body }),
    onSuccess: () => {
      setNote('');
      invalidate();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const retrySync = useMutation({
    mutationFn: () => api.post(`/leads/${id}/retry-sync`),
    onSuccess: invalidate,
    onError: (err) => setError(errorMessage(err)),
  });

  if (query.isLoading) return <Spinner />;
  const lead = query.data;
  if (!lead) return <ErrorState message="Lead not found" />;

  return (
    <>
      <Link
        to="/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="size-4" />
        Back to leads
      </Link>

      <PageHeader
        title={lead.leadRef}
        subtitle={`Captured ${formatRelative(lead.createdAt)} · ${formatDateTime(lead.createdAt)}`}
        actions={
          <>
            <Select
              value={lead.status}
              onChange={(e) => updateStatus.mutate(e.target.value as LeadStatus)}
              disabled={updateStatus.isPending}
            >
              <option value="NEW">New</option>
              <option value="FOLLOW_UP">Follow-up</option>
              <option value="CLOSED">Closed</option>
            </Select>
            <Button
              variant="secondary"
              onClick={() => retrySync.mutate()}
              loading={retrySync.isPending}
            >
              <RefreshCw className="size-4" />
              Retry sync
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Lead details</h2>
              <Badge className={LEAD_STATUS_CLASS[lead.status]}>
                {LEAD_STATUS_LABEL[lead.status]}
              </Badge>
            </div>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Field label="Name" value={lead.name} />
              <Field label="WhatsApp Number" value={formatPhone(lead.whatsappNumber)} />
              <Field label="Email" value={lead.email} />
              <Field label="Business Name" value={lead.businessName} />
              <Field label="Main Category" value={MAIN_CATEGORY_LABEL[lead.mainCategory]} />
              <Field label="Subcategory" value={humanise(lead.subCategory)} />
              <Field label="Product / Business Category" value={lead.productCategory} />
              <Field label="City" value={lead.city} />
            </dl>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <Field label="Requirement" value={lead.requirement} />
            </div>
          </Card>

          {lead.rawAnswers && Object.keys(lead.rawAnswers).length > 0 && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-800">
                Everything the bot collected
              </h2>
              <dl className="grid gap-4 sm:grid-cols-2">
                {Object.entries(lead.rawAnswers).map(([key, value]) => (
                  <Field key={key} label={humanise(key.replace(/([A-Z])/g, '_$1'))} value={value} />
                ))}
              </dl>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Notes</h2>

            <div className="flex gap-2">
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a follow-up note…"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              />
              <Button
                onClick={() => addNote.mutate(note.trim())}
                disabled={!note.trim()}
                loading={addNote.isPending}
              >
                Add
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {lead.notes?.length ? (
                lead.notes.map((n) => (
                  <div key={n.id} className="rounded-lg bg-slate-50 px-4 py-3">
                    <p className="msg-body text-sm text-slate-700">{n.body}</p>
                    <p className="mt-1.5 text-xs text-slate-400">
                      {n.user.name} · {formatDateTime(n.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">No notes yet.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">Integrations</h2>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Google Sheets</span>
                  <Badge className={SYNC_STATUS_CLASS[lead.sheetSyncStatus]}>
                    {humanise(lead.sheetSyncStatus)}
                  </Badge>
                </div>
                {lead.sheetSyncError && (
                  <p className="mt-1.5 text-xs text-red-600">{lead.sheetSyncError}</p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Admin notification</span>
                  <Badge className={SYNC_STATUS_CLASS[lead.notifySyncStatus]}>
                    {humanise(lead.notifySyncStatus)}
                  </Badge>
                </div>
                {lead.notifyError && (
                  <p className="mt-1.5 text-xs text-red-600">{lead.notifyError}</p>
                )}
              </div>
            </div>
          </Card>

          {lead.customer && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Customer</h2>
              <p className="text-sm text-slate-800">
                {lead.customer.profileName || lead.name || 'Unknown'}
              </p>
              <p className="text-sm text-slate-500">{formatPhone(lead.customer.whatsappNumber)}</p>
              <Link
                to={`/customers/${lead.customer.id}`}
                className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                View profile & history →
              </Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

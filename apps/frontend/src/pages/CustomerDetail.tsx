import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Customer, Message, Paginated } from '@/lib/types';
import {
  LEAD_STATUS_CLASS,
  LEAD_STATUS_LABEL,
  MAIN_CATEGORY_LABEL,
  formatDateTime,
  formatPhone,
  humanise,
} from '@/lib/format';
import { Badge, Button, Card, ErrorState, PageHeader, Spinner } from '@/components/ui';
import MessageThread from '@/components/MessageThread';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const customer = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await api.get<Customer>(`/customers/${id}`)).data,
    enabled: !!id,
  });

  const messages = useQuery({
    queryKey: ['customer', id, 'messages'],
    queryFn: async () =>
      (await api.get<Paginated<Message>>(`/customers/${id}/messages?limit=200`)).data,
    enabled: !!id,
  });

  const toggleBlock = useMutation({
    mutationFn: (isBlocked: boolean) => api.patch(`/customers/${id}/block`, { isBlocked }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer', id] }),
  });

  if (customer.isLoading) return <Spinner />;
  const data = customer.data;
  if (!data) return <ErrorState message="Customer not found" />;

  return (
    <>
      <Link
        to="/customers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="size-4" />
        Back to customers
      </Link>

      <PageHeader
        title={data.name || data.profileName || 'Unknown customer'}
        subtitle={formatPhone(data.whatsappNumber)}
        actions={
          <Button
            variant={data.isBlocked ? 'secondary' : 'danger'}
            onClick={() => toggleBlock.mutate(!data.isBlocked)}
            loading={toggleBlock.isPending}
          >
            {data.isBlocked ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
            {data.isBlocked ? 'Unblock' : 'Block'}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">Profile</h2>
            <dl className="space-y-4">
              {[
                ['WhatsApp Number', formatPhone(data.whatsappNumber)],
                ['WhatsApp Profile Name', data.profileName],
                ['Email', data.email],
                ['Business', data.businessName],
                ['Business Category', data.businessCategory],
                ['City', data.city],
                ['First seen', formatDateTime(data.createdAt)],
                ['Last interaction', formatDateTime(data.lastInteractionAt)],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    {label}
                  </dt>
                  <dd className="mt-0.5 text-sm text-slate-800">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {data.session && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Live bot session</h2>
              <p className="text-sm text-slate-600">
                Currently at{' '}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  {data.session.currentNode}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Last message {formatDateTime(data.session.lastMessageAt)}
              </p>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">
              Leads ({data.leads?.length ?? 0})
            </h2>
            {data.leads?.length ? (
              <div className="space-y-2">
                {data.leads.map((lead) => (
                  <Link
                    key={lead.id}
                    to={`/leads/${lead.id}`}
                    className="block rounded-lg border border-slate-200 px-3 py-2.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-brand-600">{lead.leadRef}</span>
                      <Badge className={LEAD_STATUS_CLASS[lead.status]}>
                        {LEAD_STATUS_LABEL[lead.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {MAIN_CATEGORY_LABEL[lead.mainCategory]} · {humanise(lead.subCategory)}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No leads from this customer yet.</p>
            )}
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-800">
              Conversation history ({messages.data?.total ?? 0} messages)
            </h2>
          </div>
          <div className="max-h-[70vh] overflow-y-auto bg-slate-50">
            {messages.isLoading ? <Spinner /> : <MessageThread messages={messages.data?.items ?? []} />}
          </div>
        </Card>
      </div>
    </>
  );
}

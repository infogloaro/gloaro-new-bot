import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Send, UserCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { Conversation } from '@/lib/types';
import { LEAD_STATUS_CLASS, LEAD_STATUS_LABEL, formatPhone, humanise } from '@/lib/format';
import { Badge, Button, Card, ErrorState, PageHeader, Spinner } from '@/components/ui';
import MessageThread from '@/components/MessageThread';

export default function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['conversation', id],
    queryFn: async () => (await api.get<Conversation>(`/conversations/${id}`)).data,
    enabled: !!id,
    refetchInterval: 15_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['conversation', id] });

  const takeOver = useMutation({
    mutationFn: () => api.post(`/conversations/${id}/take-over`),
    onSuccess: invalidate,
    onError: (err) => setError(errorMessage(err)),
  });

  const release = useMutation({
    mutationFn: () => api.post(`/conversations/${id}/release`),
    onSuccess: invalidate,
    onError: (err) => setError(errorMessage(err)),
  });

  const sendReply = useMutation({
    mutationFn: (body: string) => api.post(`/conversations/${id}/reply`, { body }),
    onSuccess: () => {
      setReply('');
      invalidate();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (query.isLoading) return <Spinner />;
  const conversation = query.data;
  if (!conversation) return <ErrorState message="Conversation not found" />;

  const customer = conversation.customer;

  return (
    <>
      <Link
        to="/conversations"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="size-4" />
        Back to conversations
      </Link>

      <PageHeader
        title={customer.name || customer.profileName || 'Unknown customer'}
        subtitle={`${formatPhone(customer.whatsappNumber)} · ${conversation.messageCount} messages`}
        actions={
          conversation.isHandedOver ? (
            <Button variant="secondary" onClick={() => release.mutate()} loading={release.isPending}>
              <Bot className="size-4" />
              Hand back to bot
            </Button>
          ) : (
            <Button onClick={() => takeOver.mutate()} loading={takeOver.isPending}>
              <UserCheck className="size-4" />
              Take over
            </Button>
          )
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-800">Messages</h2>
            {conversation.isHandedOver ? (
              <Badge className="bg-violet-100 text-violet-700 ring-violet-600/20">
                Agent handling — bot is silent
              </Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-700 ring-emerald-600/20">
                Bot responding
              </Badge>
            )}
          </div>

          <div className="max-h-[60vh] flex-1 overflow-y-auto bg-slate-50">
            <MessageThread messages={conversation.messages ?? []} />
          </div>

          <div className="border-t border-slate-200 p-4">
            {!conversation.isHandedOver && (
              <p className="mb-2 text-xs text-amber-600">
                Sending a reply will take this conversation over and silence the bot.
              </p>
            )}
            <div className="flex gap-2">
              <textarea
                rows={2}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type a reply to send on WhatsApp…"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              />
              <Button
                onClick={() => sendReply.mutate(reply.trim())}
                disabled={!reply.trim()}
                loading={sendReply.isPending}
              >
                <Send className="size-4" />
                Send
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Customer</h2>
            <p className="text-sm text-slate-800">{customer.name || customer.profileName || '—'}</p>
            <p className="text-sm text-slate-500">{formatPhone(customer.whatsappNumber)}</p>
            {customer.city && <p className="mt-1 text-sm text-slate-500">{customer.city}</p>}
            <Link
              to={`/customers/${customer.id}`}
              className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              View full profile →
            </Link>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">
              Leads from this conversation
            </h2>
            {conversation.leads?.length ? (
              <div className="space-y-2">
                {conversation.leads.map((lead) => (
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
                    <p className="mt-1 text-xs text-slate-500">{humanise(lead.subCategory)}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No leads captured yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

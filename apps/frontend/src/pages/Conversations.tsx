import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import type { Conversation, ConversationStatus, Paginated } from '@/lib/types';
import { formatPhone, formatSmartDate } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Spinner,
} from '@/components/ui';

const STATUS_CLASS: Record<ConversationStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20',
  IDLE: 'bg-amber-100 text-amber-700 ring-amber-600/20',
  CLOSED: 'bg-slate-200 text-slate-600 ring-slate-500/20',
};

export default function Conversations() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<ConversationStatus | ''>('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [debounced, status]);

  const query = useQuery({
    queryKey: ['conversations', { page, debounced, status }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debounced) params.set('search', debounced);
      if (status) params.set('status', status);
      return (await api.get<Paginated<Conversation>>(`/conversations?${params}`)).data;
    },
    refetchInterval: 20_000,
  });

  return (
    <>
      <PageHeader title="Conversations" subtitle="Live and past WhatsApp threads" />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Search</label>
            <div className="relative">
              <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Customer name or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Status</label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as ConversationStatus | '')}
            >
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="IDLE">Idle</option>
              <option value="CLOSED">Closed</option>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : !query.data || query.data.items.length === 0 ? (
          <EmptyState title="No conversations yet" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5">Customer</th>
                    <th className="px-5 py-2.5">Phone</th>
                    <th className="px-5 py-2.5">Last message</th>
                    <th className="px-5 py-2.5">Messages</th>
                    <th className="px-5 py-2.5">Handled by</th>
                    <th className="px-5 py-2.5">Status</th>
                    <th className="px-5 py-2.5">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {query.data.items.map((conversation) => {
                    const last = conversation.messages?.[0];
                    return (
                      <tr key={conversation.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <Link
                            to={`/conversations/${conversation.id}`}
                            className="font-medium text-brand-600 hover:text-brand-700"
                          >
                            {conversation.customer.name ||
                              conversation.customer.profileName ||
                              'Unknown'}
                          </Link>
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                          {formatPhone(conversation.customer.whatsappNumber)}
                        </td>
                        <td className="max-w-72 px-5 py-3">
                          <p className="truncate text-slate-600">
                            {last?.body?.split('\n')[0] ?? '—'}
                          </p>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{conversation.messageCount}</td>
                        <td className="px-5 py-3">
                          {conversation.isHandedOver ? (
                            <Badge className="bg-violet-100 text-violet-700 ring-violet-600/20">
                              {conversation.agent?.name ?? 'Agent'}
                            </Badge>
                          ) : (
                            <Badge>Bot</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <Badge className={STATUS_CLASS[conversation.status]}>
                            {conversation.status.charAt(0) +
                              conversation.status.slice(1).toLowerCase()}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap text-slate-500">
                          {formatSmartDate(conversation.lastMessageAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={query.data.page}
              totalPages={query.data.totalPages}
              total={query.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}

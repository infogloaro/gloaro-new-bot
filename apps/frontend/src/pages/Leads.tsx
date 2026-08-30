import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import type { Lead, LeadStatus, MainCategory, Paginated } from '@/lib/types';
import {
  LEAD_STATUS_CLASS,
  LEAD_STATUS_LABEL,
  MAIN_CATEGORY_LABEL,
  SYNC_STATUS_CLASS,
  formatPhone,
  formatSmartDate,
  humanise,
} from '@/lib/format';
import { Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, Spinner } from '@/components/ui';

export default function Leads() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [category, setCategory] = useState<MainCategory | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Debounce so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Any filter change invalidates the current page number.
  useEffect(() => setPage(1), [debounced, status, category, from, to]);

  const query = useQuery({
    queryKey: ['leads', { page, debounced, status, category, from, to }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debounced) params.set('search', debounced);
      if (status) params.set('status', status);
      if (category) params.set('mainCategory', category);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return (await api.get<Paginated<Lead>>(`/leads?${params}`)).data;
    },
  });

  return (
    <>
      <PageHeader title="Leads" subtitle="Every enquiry captured by the WhatsApp bot" />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Search</label>
            <div className="relative">
              <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Name, phone, business, requirement, ref…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Status</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | '')}>
              <option value="">All</option>
              <option value="NEW">New</option>
              <option value="FOLLOW_UP">Follow-up</option>
              <option value="CLOSED">Closed</option>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Category</label>
            <Select value={category} onChange={(e) => setCategory(e.target.value as MainCategory | '')}>
              <option value="">All</option>
              <option value="GLOARO_MART">GloAro Mart</option>
              <option value="DIGITAL_NETWORK">Digital Network</option>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : !query.data || query.data.items.length === 0 ? (
          <EmptyState title="No leads match these filters" hint="Try clearing the search or date range." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5">Ref</th>
                    <th className="px-5 py-2.5">Name</th>
                    <th className="px-5 py-2.5">Phone</th>
                    <th className="px-5 py-2.5">Category</th>
                    <th className="px-5 py-2.5">City</th>
                    <th className="px-5 py-2.5">Requirement</th>
                    <th className="px-5 py-2.5">Sync</th>
                    <th className="px-5 py-2.5">Status</th>
                    <th className="px-5 py-2.5">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {query.data.items.map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Link
                          to={`/leads/${lead.id}`}
                          className="font-medium text-brand-600 hover:text-brand-700"
                        >
                          {lead.leadRef}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-slate-800">{lead.name ?? '—'}</div>
                        {lead.businessName && (
                          <div className="text-xs text-slate-400">{lead.businessName}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                        {formatPhone(lead.whatsappNumber)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-slate-700">{MAIN_CATEGORY_LABEL[lead.mainCategory]}</div>
                        <div className="text-xs text-slate-400">{humanise(lead.subCategory)}</div>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{lead.city ?? '—'}</td>
                      <td className="max-w-64 px-5 py-3">
                        <p className="truncate text-slate-600" title={lead.requirement ?? ''}>
                          {lead.requirement ?? '—'}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1">
                          <Badge className={SYNC_STATUS_CLASS[lead.sheetSyncStatus]}>Sheet</Badge>
                          <Badge className={SYNC_STATUS_CLASS[lead.notifySyncStatus]}>Alert</Badge>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge className={LEAD_STATUS_CLASS[lead.status]}>
                          {LEAD_STATUS_LABEL[lead.status]}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-500">
                        {formatSmartDate(lead.createdAt)}
                      </td>
                    </tr>
                  ))}
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

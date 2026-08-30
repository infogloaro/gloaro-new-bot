import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import type { Customer, Paginated } from '@/lib/types';
import { formatPhone, formatSmartDate } from '@/lib/format';
import { Badge, Card, EmptyState, Input, PageHeader, Pagination, Spinner } from '@/components/ui';

export default function Customers() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [debounced]);

  const query = useQuery({
    queryKey: ['customers', { page, debounced }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debounced) params.set('search', debounced);
      return (await api.get<Paginated<Customer>>(`/customers?${params}`)).data;
    },
  });

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who has messaged the GloAro WhatsApp number" />

      <Card className="mb-4 p-4">
        <div className="relative max-w-md">
          <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search by name, phone, business or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : !query.data || query.data.items.length === 0 ? (
          <EmptyState title="No customers found" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5">Name</th>
                    <th className="px-5 py-2.5">WhatsApp Number</th>
                    <th className="px-5 py-2.5">Business</th>
                    <th className="px-5 py-2.5">Category</th>
                    <th className="px-5 py-2.5">City</th>
                    <th className="px-5 py-2.5">Leads</th>
                    <th className="px-5 py-2.5">Last Interaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {query.data.items.map((customer) => (
                    <tr key={customer.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link
                          to={`/customers/${customer.id}`}
                          className="font-medium text-brand-600 hover:text-brand-700"
                        >
                          {customer.name || customer.profileName || 'Unknown'}
                        </Link>
                        {customer.isBlocked && (
                          <Badge className="ml-2 bg-red-100 text-red-700 ring-red-600/20">
                            Blocked
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                        {formatPhone(customer.whatsappNumber)}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{customer.businessName ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{customer.businessCategory ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{customer.city ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{customer._count?.leads ?? 0}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-500">
                        {formatSmartDate(customer.lastInteractionAt)}
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

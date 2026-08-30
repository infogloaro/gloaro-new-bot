import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ClipboardList, MessagesSquare, Sparkles, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { DashboardSummary } from '@/lib/types';
import {
  LEAD_STATUS_CLASS,
  LEAD_STATUS_LABEL,
  MAIN_CATEGORY_LABEL,
  formatPhone,
  formatSmartDate,
  humanise,
} from '@/lib/format';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  accent?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`grid size-9 place-items-center rounded-lg ${accent ?? 'bg-slate-100 text-slate-500'}`}>
          <Icon className="size-4.5" />
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const summary = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardSummary>('/dashboard')).data,
    // The dashboard is the screen people leave open, so keep it fresh.
    refetchInterval: 30_000,
  });

  const trend = useQuery({
    queryKey: ['dashboard', 'trend'],
    queryFn: async () =>
      (await api.get<{ date: string; count: number }[]>('/dashboard/leads-trend?days=14')).data,
  });

  if (summary.isLoading) return <Spinner />;
  const data = summary.data;
  if (!data) return <EmptyState title="Could not load the dashboard" />;

  const health = data.health;
  const hasIssues = health.pendingSheetSync > 0 || health.failedNotifications > 0;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Leads, customers and bot activity at a glance" />

      {hasIssues && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">Some integrations need attention</p>
            <p className="mt-0.5">
              {health.pendingSheetSync > 0 && (
                <>{health.pendingSheetSync} lead(s) not yet written to Google Sheets. </>
              )}
              {health.failedNotifications > 0 && (
                <>{health.failedNotifications} admin notification(s) failed. </>
              )}
              Open a lead and use “Retry sync”, or check Settings.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Total Leads"
          value={data.totalLeads}
          icon={ClipboardList}
          accent="bg-brand-50 text-brand-600"
        />
        <Stat label="New Leads" value={data.newLeads} icon={Sparkles} accent="bg-blue-50 text-blue-600" />
        <Stat label="Follow-up" value={data.followUp} icon={ClipboardList} accent="bg-amber-50 text-amber-600" />
        <Stat label="Closed" value={data.closed} icon={ClipboardList} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Today's Leads" value={data.todayLeads} icon={Sparkles} accent="bg-brand-50 text-brand-600" />
        <Stat label="Customers" value={data.customers} icon={Users} accent="bg-violet-50 text-violet-600" />
        <Stat
          label="Active Conversations"
          value={data.activeConversations}
          icon={MessagesSquare}
          accent="bg-sky-50 text-sky-600"
        />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-slate-800">Leads — last 14 days</h2>
        <div className="mt-4 h-56">
          {trend.data && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend.data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0b7a4b" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#0b7a4b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => d.slice(5).replace('-', '/')}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  labelFormatter={(d: string) => d}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Leads"
                  stroke="#0b7a4b"
                  strokeWidth={2}
                  fill="url(#leadFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Recent leads</h2>
          <Link to="/leads" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            View all
          </Link>
        </div>

        {data.recentLeads.length === 0 ? (
          <EmptyState title="No leads yet" hint="They will appear here as customers complete a flow." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-5 py-2.5">Ref</th>
                  <th className="px-5 py-2.5">Name</th>
                  <th className="px-5 py-2.5">Phone</th>
                  <th className="px-5 py-2.5">Category</th>
                  <th className="px-5 py-2.5">City</th>
                  <th className="px-5 py-2.5">Status</th>
                  <th className="px-5 py-2.5">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link
                        to={`/leads/${lead.id}`}
                        className="font-medium text-brand-600 hover:text-brand-700"
                      >
                        {lead.leadRef}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-800">{lead.name ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{formatPhone(lead.whatsappNumber)}</td>
                    <td className="px-5 py-3 text-slate-600">
                      <div>{MAIN_CATEGORY_LABEL[lead.mainCategory]}</div>
                      <div className="text-xs text-slate-400">{humanise(lead.subCategory)}</div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{lead.city ?? '—'}</td>
                    <td className="px-5 py-3">
                      <Badge className={LEAD_STATUS_CLASS[lead.status]}>
                        {LEAD_STATUS_LABEL[lead.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{formatSmartDate(lead.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

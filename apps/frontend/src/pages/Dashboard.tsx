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
import { Badge, Card, EmptyState, IconTile, PageHeader, Spinner } from '@/components/ui';

function Stat({
  label,
  value,
  icon: Icon,
  variant = 'navy',
}: {
  label: string;
  value: number;
  icon: typeof Users;
  variant?: 'navy' | 'gold';
}) {
  return (
    <Card className="relative overflow-hidden p-5">
      <div
        className={`pointer-events-none absolute -top-8 -right-8 size-24 rounded-full blur-2xl ${
          variant === 'gold' ? 'bg-[#f2c75c]/30' : 'bg-[#163d73]/15'
        }`}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-[#6b7a90]">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-[#10233f]">{value}</p>
        </div>
        <IconTile icon={Icon} variant={variant} />
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
        <Stat label="Total Leads" value={data.totalLeads} icon={ClipboardList} variant="navy" />
        <Stat label="New Leads" value={data.newLeads} icon={Sparkles} variant="gold" />
        <Stat label="Follow-up" value={data.followUp} icon={ClipboardList} variant="navy" />
        <Stat label="Closed" value={data.closed} icon={ClipboardList} variant="navy" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Today's Leads" value={data.todayLeads} icon={Sparkles} variant="gold" />
        <Stat label="Customers" value={data.customers} icon={Users} variant="navy" />
        <Stat
          label="Active Conversations"
          value={data.activeConversations}
          icon={MessagesSquare}
          variant="navy"
        />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-bold text-[#10233f]">Leads — last 14 days</h2>
        <div className="mt-4 h-56">
          {trend.data && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend.data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#163d73" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#163d73" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#dce4ed" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => d.slice(5).replace('-', '/')}
                  tick={{ fontSize: 11, fill: '#6b7a90' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#6b7a90' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #dce4ed' }}
                  labelFormatter={(d: string) => d}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Leads"
                  stroke="#163d73"
                  strokeWidth={2}
                  fill="url(#leadFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <div className="flex items-center justify-between border-b border-white/60 px-5 py-4">
          <h2 className="text-sm font-bold text-[#10233f]">Recent leads</h2>
          <Link to="/leads" className="text-sm font-semibold text-[#d9a21b] hover:text-[#a87508]">
            View all
          </Link>
        </div>

        {data.recentLeads.length === 0 ? (
          <EmptyState title="No leads yet" hint="They will appear here as customers complete a flow." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#e8edf3]/60 text-left text-xs font-semibold tracking-wide text-[#6b7a90] uppercase">
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
              <tbody className="divide-y divide-white/60">
                {data.recentLeads.map((lead) => (
                  <tr key={lead.id} className="transition-colors hover:bg-white/50">
                    <td className="px-5 py-3">
                      <Link
                        to={`/leads/${lead.id}`}
                        className="font-semibold text-[#163d73] hover:text-[#0b2345]"
                      >
                        {lead.leadRef}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[#10233f]">{lead.name ?? '—'}</td>
                    <td className="px-5 py-3 text-[#6b7a90]">{formatPhone(lead.whatsappNumber)}</td>
                    <td className="px-5 py-3 text-[#6b7a90]">
                      <div>{MAIN_CATEGORY_LABEL[lead.mainCategory]}</div>
                      <div className="text-xs text-[#94a3b8]">{humanise(lead.subCategory)}</div>
                    </td>
                    <td className="px-5 py-3 text-[#6b7a90]">{lead.city ?? '—'}</td>
                    <td className="px-5 py-3">
                      <Badge className={LEAD_STATUS_CLASS[lead.status]}>
                        {LEAD_STATUS_LABEL[lead.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-[#94a3b8]">{formatSmartDate(lead.createdAt)}</td>
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

import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Users,
  MessagesSquare,
  ClipboardList,
  Workflow,
  Settings as SettingsIcon,
  MessageCircle,
  FlaskConical,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/leads', label: 'Leads', icon: ClipboardList },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { to: '/bot', label: 'Bot Menu', icon: Workflow },
  { to: '/simulator', label: 'Simulator', icon: FlaskConical },
  { to: '/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: true },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid size-9 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            GA
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">GloAro</p>
            <p className="text-xs text-slate-500">WhatsApp Admin</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <Icon className="size-4.5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="px-2 pb-2">
            <p className="truncate text-sm font-medium text-slate-800">{user?.name}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut className="size-4.5" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

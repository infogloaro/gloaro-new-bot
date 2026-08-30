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
      <aside className="sidebar-gradient flex w-64 shrink-0 flex-col">
        <div className="px-5 py-6">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
            <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl gold-gradient shadow-[0_4px_14px_rgba(217,162,27,0.4)]">
              <img
                src="https://www.gloaro.com/assets/logo-ByhasI7u.png"
                alt="GloAro"
                className="size-7 object-contain"
              />
            </div>
            <div>
              <p className="text-sm font-bold tracking-wide text-white">GloAro</p>
              <p className="text-[11px] font-medium text-[#f2c75c]">WhatsApp Admin</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-gradient-to-r from-[#f8fafc] to-[#eef4fb] text-[#0b2345] shadow-[0_4px_14px_rgba(0,0,0,0.25)]'
                    : 'text-[#c7d4e6] hover:bg-white/8 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 h-6 w-1 rounded-r-full gold-gradient" />
                  )}
                  <Icon className="size-4.5" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="px-2 pb-2">
            <p className="truncate text-sm font-medium text-white">{user?.name}</p>
            <p className="truncate text-xs text-[#8ea3c2]">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium text-[#c7d4e6] transition-all duration-200 hover:bg-white/8 hover:text-white"
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

import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('clay-surface clay-pressable', className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#10233f]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#6b7a90]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        className ?? 'bg-slate-100 text-slate-600 ring-slate-500/20',
      )}
    >
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const styles = {
    primary:
      'navy-gradient text-white shadow-[0_6px_16px_rgba(11,35,69,0.35)] hover:brightness-110 hover:shadow-[0_6px_18px_rgba(217,162,27,0.35)] disabled:opacity-50',
    secondary:
      'gold-gradient text-[#0b2345] shadow-[0_4px_12px_rgba(217,162,27,0.3)] hover:brightness-105 disabled:opacity-50',
    ghost: 'bg-transparent text-[#163d73] hover:bg-[#e8edf3]',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
  }[variant];

  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold',
        'transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed',
        styles,
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'clay-inset w-full px-3.5 py-2.5 text-sm text-[#10233f] outline-none',
        'placeholder:text-[#94a3b8] transition-shadow duration-200',
        'focus:border-[#163d73] focus:shadow-[0_0_0_3px_rgba(217,162,27,0.18)]',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        'clay-inset px-3.5 py-2.5 text-sm text-[#10233f] outline-none transition-shadow duration-200',
        'focus:border-[#163d73] focus:shadow-[0_0_0_3px_rgba(217,162,27,0.18)]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#6b7a90]">
      <Loader2 className="size-5 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-sm font-medium text-[#10233f]">{title}</p>
      {hint && <p className="mt-1 text-sm text-[#6b7a90]">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

/** Rounded 3D/clay icon container - navy by default, gold for emphasis. */
export function IconTile({
  icon: Icon,
  variant = 'navy',
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  variant?: 'navy' | 'gold';
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'grid size-11 shrink-0 place-items-center rounded-2xl',
        variant === 'gold'
          ? 'gold-gradient shadow-[0_4px_12px_rgba(217,162,27,0.35)]'
          : 'navy-gradient shadow-[0_4px_12px_rgba(11,35,69,0.35)]',
        className,
      )}
    >
      <Icon className={clsx('size-5', variant === 'gold' ? 'text-[#0b2345]' : 'text-white')} />
    </div>
  );
}

/** Simple page-count control shared by every list screen. */
export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-white/60 px-4 py-3 text-sm">
      <span className="text-[#6b7a90]">
        Page {page} of {Math.max(1, totalPages)} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

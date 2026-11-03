import { CircleNotch, WarningCircle } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-saffron text-on-accent hover:opacity-90',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
  danger: 'bg-danger text-on-accent hover:opacity-90',
};

// eslint-disable-next-line react-refresh/only-export-components
export function buttonClass(variant: Variant = 'primary', extra = '') {
  return `inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      type="button"
      className={buttonClass(variant, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <CircleNotch size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export const inputClass =
  'block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30 aria-[invalid=true]:border-danger';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted">
      <CircleNotch size={18} className="animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-danger/40 bg-surface p-4 text-sm"
    >
      <div className="flex items-center gap-2 text-danger">
        <WarningCircle size={18} aria-hidden />
        <span>{message}</span>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
      {icon && <div className="text-saffron">{icon}</div>}
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </div>
  );
}

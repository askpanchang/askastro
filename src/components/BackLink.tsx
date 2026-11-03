import { ArrowLeft } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-text"
    >
      <ArrowLeft size={16} aria-hidden />
      {children}
    </Link>
  );
}

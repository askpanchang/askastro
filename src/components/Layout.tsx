import { Link, Outlet } from 'react-router';
import { APP_NAME } from '../../shared/app';
import { GearSix, Lightning } from '@phosphor-icons/react';
import { useMe } from '../api/me';
import { useUsage } from '../api/usage';
import { headlinePercent } from '../lib/usageFormat';
import { ThemeToggle } from './ThemeToggle';

export function Layout() {
  const me = useMe();
  const usage = useUsage();
  const headline = usage.data ? headlinePercent(usage.data) : null;
  const used = headline?.percent ?? null;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold text-text">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            {APP_NAME}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/usage"
              className={`inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface-2 ${used !== null && used >= 80 ? 'text-amber' : 'text-muted'}`}
              aria-label={
                headline ? `AI usage: ${headline.percent}% of ${headline.of}` : 'AI usage'
              }
            >
              <Lightning size={14} aria-hidden />
              {used === null ? 'Usage' : `${used}%`}
            </Link>
            {me.data?.isAdmin && (
              <Link
                to="/settings"
                className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-text"
                aria-label="Settings"
                title="Settings"
              >
                <GearSix size={18} aria-hidden />
              </Link>
            )}
            {me.data && me.data.email !== 'default' && (
              <span
                className="hidden max-w-48 truncate text-xs text-muted sm:inline"
                title="Signed in as"
              >
                {me.data.email}
              </span>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

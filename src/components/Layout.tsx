import { Link, Outlet } from 'react-router';
import { APP_NAME } from '../../shared/app';
import { ThemeToggle } from './ThemeToggle';

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold text-text">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            {APP_NAME}
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useHealth } from '../api/health';

export function HomePage() {
  const health = useHealth();

  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">Profiles</h1>
      <p className="text-muted">Birth profiles, kundali charts and Q&amp;A will appear here.</p>
      <div
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        role="status"
      >
        {health.isPending && <span className="text-muted">Checking API…</span>}
        {health.isError && (
          <>
            <WarningCircle size={18} className="text-danger" aria-hidden />
            <span>API unreachable</span>
          </>
        )}
        {health.data && (
          <>
            <CheckCircle size={18} className="text-teal" aria-hidden />
            <span>API ok · database {health.data.db}</span>
          </>
        )}
      </div>
    </section>
  );
}

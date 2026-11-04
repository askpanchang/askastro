import { useUsage } from '../api/usage';
import { UsageMeters } from '../components/UsageMeter';
import { pct } from '../lib/usageFormat';
import { ErrorState, Spinner } from '../components/ui';

const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const dayFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

export function UsagePage() {
  const usage = useUsage();
  if (usage.isPending) return <Spinner label="Loading usage…" />;
  if (usage.isError) {
    return <ErrorState message={usage.error.message} onRetry={() => void usage.refetch()} />;
  }
  const u = usage.data;
  const maxDay = Math.max(
    u.budget,
    ...(u.history ?? []).map((h) => h.accountNeurons ?? h.appNeurons),
  );

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">AI usage</h1>
        <p className="text-sm text-muted">
          Answers use Cloudflare Workers AI, measured in neurons. The app has {fmt.format(u.budget)}{' '}
          neurons a day; each person can use up to {fmt.format(u.userLimit)}. A typical answer uses
          about 150–500.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <UsageMeters usage={u} />
      </div>

      {u.people && (
        <section aria-labelledby="people-heading" className="space-y-3">
          <h2 id="people-heading" className="text-xl font-semibold">
            Today by person
          </h2>
          {u.people.length === 0 ? (
            <p className="text-sm text-muted">No questions yet today.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="border-b border-border bg-surface-2 text-xs text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Person
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Questions
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Neurons
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Of their share
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {u.people.map((p) => (
                    <tr key={p.email}>
                      <th scope="row" className="px-3 py-2 font-medium break-all">
                        {p.email}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">{p.questions}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.format(p.neurons)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {pct(p.neurons, u.userLimit)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {u.history && (
        <section aria-labelledby="history-heading" className="space-y-3">
          <h2 id="history-heading" className="text-xl font-semibold">
            Last 7 days
          </h2>
          <ul className="space-y-2">
            {u.history.map((h) => {
              const total = h.accountNeurons ?? h.appNeurons;
              return (
                <li
                  key={h.day}
                  className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm"
                >
                  <span className="text-muted">
                    {dayFmt.format(new Date(`${h.day}T00:00:00Z`))}
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <span
                      className={`block h-full ${total >= u.budget ? 'bg-danger' : 'bg-indigo'}`}
                      style={{ width: `${Math.min(100, (total / maxDay) * 100)}%` }}
                    />
                  </span>
                  <span className="tabular-nums">
                    {fmt.format(total)}
                    {h.accountNeurons !== null && h.accountNeurons > h.appNeurons + 1 && (
                      <span className="text-muted"> ({fmt.format(h.appNeurons)} this app)</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {u.history.some((h) => h.accountNeurons === null) && (
            <p className="text-xs text-muted">
              Showing this app's estimate. Add a read-only analytics token to see the whole account.
            </p>
          )}
        </section>
      )}
    </section>
  );
}

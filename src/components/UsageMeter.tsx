import { Lightning } from '@phosphor-icons/react';
import { Link } from 'react-router';
import type { Usage } from '../../shared/usage';
import { useUsage } from '../api/usage';
import { useTicker } from '../lib/useTicker';
import { headlinePercent, pct, untilReset } from '../lib/usageFormat';

const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function Bar({
  label,
  used,
  limit,
  note,
}: {
  label: string;
  used: number;
  limit: number;
  note?: string;
}) {
  const p = pct(used, limit);
  const tone = p >= 100 ? 'bg-danger' : p >= 80 ? 'bg-amber' : 'bg-teal';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted tabular-nums">
          {fmt.format(used)} / {fmt.format(limit)} neurons · {p}%
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p}
      >
        <div className={`h-full ${tone}`} style={{ width: `${p}%` }} />
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

/** Full meters: your share and the account's daily budget, with the reset countdown. */
export function UsageMeters({ usage }: { usage: Usage }) {
  const now = useTicker();
  return (
    <div className="space-y-4">
      {usage.userLimit === null ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Your AI use today</p>
          <p className="text-muted tabular-nums">
            {fmt.format(usage.you.neurons)} neurons · {questions(usage.you.questions)} · no daily
            cap (admin): you can use the whole free allowance and any prepaid credits.
          </p>
        </div>
      ) : (
        <Bar
          label="Your AI use today"
          used={usage.you.neurons}
          limit={usage.userLimit}
          note={`${questions(usage.you.questions)} · resets daily`}
        />
      )}
      <Bar
        label="Whole app today (free allowance)"
        used={usage.account.neurons}
        limit={usage.budget}
        note={
          usage.account.source === 'cloudflare'
            ? 'From Cloudflare: all AI use on the account.'
            : "Estimate from this app's answers (account-wide figure not configured)."
        }
      />
      <p className="text-sm text-muted">
        Resets in {untilReset(usage.resetsAt, now)} (at {timeFmt.format(new Date(usage.resetsAt))}{' '}
        your time; 00:00 UTC).
      </p>
    </div>
  );
}

/** One-line summary for the chat composer. */
export function UsageLine() {
  const usage = useUsage();
  const now = useTicker();
  if (!usage.data) return null;
  const { percent, of } = headlinePercent(usage.data);
  return (
    <Link
      to="/usage"
      className={`inline-flex items-center gap-1 text-xs hover:underline ${percent >= 80 ? 'text-amber' : 'text-muted'}`}
    >
      <Lightning size={12} aria-hidden />
      AI today: {percent}% of {of} · resets in {untilReset(usage.data.resetsAt, now)}
    </Link>
  );
}

const questions = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`;

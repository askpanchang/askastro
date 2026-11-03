import { ChatsCircle, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { LANG_LABELS, LANGS } from '../../../shared/kundali';
import type { KundaliSummary } from '../../../shared/profile';
import { useCreateSession, useSessions } from '../../api/sessions';
import { formatRelative } from '../../lib/format';
import { useToast } from '../Toaster';
import { Button, EmptyState, ErrorState, Spinner, inputClass } from '../ui';

export function SessionsPanel({
  profileId,
  latestKundali,
}: {
  profileId: string;
  latestKundali: KundaliSummary | null;
}) {
  const sessions = useSessions(profileId);
  const create = useCreateSession(profileId);
  const navigate = useNavigate();
  const toast = useToast();
  const [lang, setLang] = useState<string>(latestKundali?.lang ?? 'en');

  const start = () =>
    create.mutate(
      { lang },
      {
        onSuccess: (s) => navigate(`/sessions/${s.id}`),
        onError: (e) => toast.error(e.message),
      },
    );

  const newSession = latestKundali ? (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="session-lang" className="block text-xs font-medium text-muted">
          Answer language
        </label>
        <select
          id="session-lang"
          className={`${inputClass} w-auto`}
          value={lang}
          onChange={(e) => setLang(e.target.value)}
        >
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_LABELS[l]}
            </option>
          ))}
        </select>
      </div>
      <Button onClick={start} loading={create.isPending}>
        <Plus size={16} weight="bold" aria-hidden />
        New session
      </Button>
    </div>
  ) : null;

  if (sessions.isPending) return <Spinner label="Loading sessions…" />;
  if (sessions.isError) {
    return <ErrorState message={sessions.error.message} onRetry={() => void sessions.refetch()} />;
  }
  const items = sessions.data.items;

  if (items.length === 0) {
    return (
      <EmptyState icon={<ChatsCircle size={40} aria-hidden />} title="No Q&A sessions yet">
        <p className="max-w-md text-sm text-muted">
          {latestKundali
            ? 'Ask questions about this chart. Answers are based on the latest kundali and saved so you can reread them later.'
            : 'Generate a kundali first, then ask questions about it here.'}
        </p>
        {newSession}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{newSession}</div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              to={`/sessions/${s.id}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2"
            >
              <span className="font-semibold">{s.title}</span>
              <span className="text-sm text-muted">
                {s.messageCount} {s.messageCount === 1 ? 'message' : 'messages'} ·{' '}
                {LANG_LABELS[s.lang]} · {formatRelative(s.updatedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

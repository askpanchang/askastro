import {
  ChartPieSlice,
  Copy,
  PaperPlaneRight,
  PencilSimple,
  Stop,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { STARTER_QUESTIONS, type Message, type Session } from '../../shared/session';
import { ApiRequestError } from '../api/client';
import { useKundali } from '../api/kundali';
import { useProfile } from '../api/profiles';
import {
  sessionKeys,
  streamAnswer,
  useDeleteSession,
  useSession,
  useUpdateSession,
} from '../api/sessions';
import { BackLink } from '../components/BackLink';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KundaliSummary } from '../components/kundali/KundaliSummary';
import { Markdown } from '../components/qa/Markdown';
import { answerMeta } from '../lib/answerMeta';
import { useToast } from '../components/Toaster';
import { UsageLine, UsageMeters } from '../components/UsageMeter';
import { usageKey, useUsage } from '../api/usage';
import { Button, ErrorState, Spinner, inputClass } from '../components/ui';

const MAX_QUESTION = 2000;

type Pending = { question: string; answer: string; state: 'streaming' };

export function SessionPage() {
  const { id = '' } = useParams();
  const detail = useSession(id);

  if (detail.isPending) return <Spinner label="Loading session…" />;
  if (detail.isError) {
    return (
      <div className="space-y-4">
        <BackLink to="/">Profiles</BackLink>
        <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
      </div>
    );
  }
  return (
    <SessionView
      session={detail.data.session}
      messages={detail.data.messages}
      kundaliOutdated={detail.data.kundaliOutdated}
    />
  );
}

function SessionView({
  session,
  messages,
  kundaliOutdated,
}: {
  session: Session;
  messages: Message[];
  kundaliOutdated: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const profile = useProfile(session.profileId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const streaming = pending?.state === 'streaming';

  // Follow new tokens unless the reader has scrolled up.
  useEffect(() => {
    const onScroll = () => {
      stickRef.current =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [pending?.answer, messages.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || question.length > MAX_QUESTION || streaming) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      stickRef.current = true;
      setDraft('');
      setPending({ question, answer: '', state: 'streaming' });
      try {
        const result = await streamAnswer(session.id, question, {
          signal: ctrl.signal,
          onToken: (t) => setPending((p) => (p ? { ...p, answer: p.answer + t } : p)),
        });
        if (result.status === 'error') toast.error(result.message);
      } catch (err) {
        if (err instanceof ApiRequestError) {
          // Rejected before anything was stored: give the question back.
          setDraft(question);
          setPending(null);
          toast.error(err.message);
          return;
        }
        toast.error('The connection dropped. The answer may still be saved; reload to check.');
      } finally {
        abortRef.current = null;
      }
      // The stored messages (complete, stopped or failed) are the source of truth.
      await qc.invalidateQueries({ queryKey: sessionKeys.detail(session.id) });
      void qc.invalidateQueries({ queryKey: usageKey });
      setPending(null);
    },
    [qc, session.id, streaming, toast],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="min-w-0 space-y-4">
        <BackLink to={`/profiles/${session.profileId}?tab=sessions`}>
          {profile.data?.profile.name ?? 'Profile'}
        </BackLink>
        <SessionHeader session={session} onOpenChart={() => setSheetOpen(true)} />

        {kundaliOutdated && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl border border-amber/40 bg-saffron-soft px-4 py-3 text-sm"
          >
            <Warning size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
            This session is tied to an earlier kundali. Its answers stay based on that chart; start
            a new session to use the latest one.
          </p>
        )}

        <h2 className="sr-only">Conversation</h2>
        <ol className="space-y-4" aria-label="Conversation">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {pending && (
            <>
              <MessageBubble
                message={{ role: 'user', content: pending.question, status: 'complete' }}
              />
              <MessageBubble
                message={{ role: 'assistant', content: pending.answer, status: pending.state }}
              />
            </>
          )}
        </ol>

        {messages.length === 0 && !pending && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void ask(q)}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-saffron hover:bg-saffron-soft"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={endRef} />

        <Composer
          value={draft}
          onChange={setDraft}
          streaming={streaming}
          onSend={() => void ask(draft)}
          onStop={() => abortRef.current?.abort()}
        />
      </section>

      <aside className="hidden lg:block">
        <div className="sticky top-20 space-y-3">
          <ChartPanel kundaliId={session.kundaliId} tz={profile.data?.profile.tz} />
        </div>
      </aside>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Chart summary"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close chart summary"
            onClick={() => setSheetOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-bg p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Chart summary</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="text-muted hover:text-text"
                aria-label="Close"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <ChartPanel kundaliId={session.kundaliId} tz={profile.data?.profile.tz} bare />
          </div>
        </div>
      )}
    </div>
  );
}

function SessionHeader({ session, onOpenChart }: { session: Session; onOpenChart: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const update = useUpdateSession(session.id, session.profileId);
  const del = useDeleteSession(session.profileId);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [confirming, setConfirming] = useState(false);

  const save = () => {
    const t = title.trim();
    if (!t || t === session.title) return setEditing(false);
    update.mutate(
      { title: t },
      { onSuccess: () => setEditing(false), onError: (e) => toast.error(e.message) },
    );
  };

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      {editing ? (
        <form
          className="flex w-full gap-2 sm:w-auto sm:flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="session-title" className="sr-only">
            Session title
          </label>
          <input
            id="session-title"
            className={`${inputClass} font-display text-xl`}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            autoFocus
          />
          <Button type="submit" loading={update.isPending}>
            Save
          </Button>
        </form>
      ) : (
        <h1 className="w-full min-w-0 text-2xl font-bold break-words sm:w-auto sm:flex-1 sm:text-3xl">
          {session.title}
          <button
            type="button"
            onClick={() => {
              setTitle(session.title);
              setEditing(true);
            }}
            className="ml-2 inline-flex align-middle text-muted hover:text-text"
            aria-label="Rename session"
          >
            <PencilSimple size={18} aria-hidden />
          </button>
        </h1>
      )}
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="lg:hidden" onClick={onOpenChart}>
          <ChartPieSlice size={16} aria-hidden />
          Chart
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(true)} aria-label="Delete session">
          <Trash size={16} aria-hidden />
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this session?"
        confirmLabel="Delete session"
        busy={del.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          del.mutate(session.id, {
            onSuccess: () => {
              toast.success('Session deleted');
              navigate(`/profiles/${session.profileId}?tab=sessions`);
            },
            onError: (e) => {
              setConfirming(false);
              toast.error(e.message);
            },
          })
        }
      >
        Its questions and answers will no longer be shown.
      </ConfirmDialog>
    </div>
  );
}

function MessageBubble({
  message,
}: {
  message: Pick<Message, 'role' | 'content' | 'status'> &
    Partial<Pick<Message, 'model' | 'tokensIn' | 'tokensOut' | 'durationMs'>>;
}) {
  const toast = useToast();
  if (message.role === 'user') {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-soft px-4 py-2.5 text-sm whitespace-pre-wrap">
          <span className="sr-only">You asked: </span>
          {message.content}
        </div>
      </li>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success('Answer copied');
    } catch {
      toast.error('Copy is not available in this browser');
    }
  };
  return (
    <li className="rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-3">
      <span className="sr-only">Answer: </span>
      {message.content ? (
        <Markdown>{message.content}</Markdown>
      ) : message.status === 'streaming' ? (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <span className="inline-flex gap-1" aria-hidden>
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-saffron" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-saffron [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-saffron [animation-delay:240ms]" />
          </span>
          Reading the chart…
        </p>
      ) : null}
      {message.status === 'error' && (
        <p role="alert" className="mt-2 flex items-center gap-2 text-sm text-danger">
          <Warning size={16} aria-hidden />
          This answer could not be completed. Ask again to retry.
        </p>
      )}
      {message.status !== 'streaming' && (answerMeta(message) || message.content) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted tabular-nums" aria-label="Answer details">
            {answerMeta(message)}
          </p>
          {message.status === 'complete' && message.content && (
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
            >
              <Copy size={14} aria-hidden />
              Copy
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Composer({
  value,
  onChange,
  streaming,
  onSend,
  onStop,
}: {
  value: string;
  onChange: (v: string) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const tooLong = value.length > MAX_QUESTION;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming && value.trim() && !tooLong) onSend();
    }
  };
  return (
    <form
      className="sticky bottom-0 -mx-4 border-t border-border bg-bg/95 px-4 pt-3 pb-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!streaming && value.trim() && !tooLong) onSend();
      }}
    >
      <label htmlFor="question" className="sr-only">
        Ask a question about this chart
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="question"
          rows={2}
          className={`${inputClass} max-h-48 resize-y`}
          placeholder={streaming ? 'Answering…' : 'Ask about career, marriage, current dasha…'}
          value={value}
          disabled={streaming}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={tooLong || undefined}
          aria-describedby="question-hint"
        />
        {streaming ? (
          <Button variant="secondary" onClick={onStop} aria-label="Stop answer">
            <Stop size={16} weight="fill" aria-hidden />
            <span className="hidden sm:inline">Stop</span>
          </Button>
        ) : (
          <Button type="submit" disabled={!value.trim() || tooLong} aria-label="Send question">
            <PaperPlaneRight size={16} weight="fill" aria-hidden />
            <span className="hidden sm:inline">Send</span>
          </Button>
        )}
      </div>
      <p id="question-hint" className={`mt-1 text-xs ${tooLong ? 'text-danger' : 'text-muted'}`}>
        {tooLong
          ? `Too long: ${value.length} / ${MAX_QUESTION} characters`
          : 'Enter to send · Shift+Enter for a new line'}
      </p>
      <div className="mt-1">
        <UsageLine />
      </div>
    </form>
  );
}

function ChartPanel({ kundaliId, tz, bare }: { kundaliId: string; tz?: string; bare?: boolean }) {
  const kundali = useKundali(kundaliId);
  if (kundali.isPending) return <Spinner label="Loading chart…" />;
  if (kundali.isError || !tz) return null;
  const k = kundali.data;
  return (
    <div className="space-y-3">
      {!bare && <h2 className="text-lg font-semibold">Chart summary</h2>}
      <KundaliSummary data={k.data} tz={tz} />
      {k.timeUncertain && (
        <p className="flex items-start gap-2 rounded-xl border border-amber/40 bg-saffron-soft px-3 py-2 text-xs">
          <Warning size={16} className="mt-0.5 shrink-0 text-amber" aria-hidden />
          Birth time unknown: ascendant and house-based answers are unreliable.
        </p>
      )}
      <AiUsageCard />
      <Link
        to={`/profiles/${k.profileId}/kundali/${k.id}`}
        className="inline-block text-sm font-semibold text-saffron underline-offset-4 hover:underline"
      >
        Open full kundali
      </Link>
    </div>
  );
}

function AiUsageCard() {
  const usage = useUsage();
  if (!usage.data) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <UsageMeters usage={usage.data} />
    </div>
  );
}

import {
  CalendarBlank,
  Clock,
  MapPin,
  PencilSimple,
  ShareNetwork,
  Trash,
  Warning,
} from '@phosphor-icons/react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { GENDER_LABELS, type ProfileDetail } from '../../shared/profile';
import { useDeleteProfile, useProfile } from '../api/profiles';
import { BackLink } from '../components/BackLink';
import { KundaliPanel } from '../components/kundali/KundaliPanel';
import { ShareDialog } from '../components/ShareDialog';
import { SessionsPanel } from '../components/qa/SessionsPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toaster';
import { Button, ErrorState, Spinner, buttonClass } from '../components/ui';
import { formatDob, formatTob } from '../lib/format';

const TABS = [
  { id: 'kundali', label: 'Kundali' },
  { id: 'sessions', label: 'Q&A sessions' },
  { id: 'details', label: 'Details' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ProfileDetailPage() {
  const { id = '', kid } = useParams();
  const navigate = useNavigate();
  const detail = useProfile(id);
  const [params] = useSearchParams();
  const tab: TabId = kid
    ? 'kundali'
    : TABS.some((t) => t.id === params.get('tab'))
      ? (params.get('tab') as TabId)
      : 'kundali';

  if (detail.isPending) return <Spinner label="Loading profile…" />;
  if (detail.isError) {
    return (
      <div className="space-y-4">
        <BackLink to="/">Profiles</BackLink>
        <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const { profile, latestKundali } = detail.data;

  return (
    <section className="space-y-6">
      <BackLink to="/">Profiles</BackLink>
      <Header data={detail.data} />

      {latestKundali?.stale && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber/40 bg-saffron-soft p-3 text-sm"
        >
          <Warning size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
          Birth details changed since the latest kundali was generated. Regenerate it to use the new
          details.
        </div>
      )}

      <Tabs
        active={tab}
        onChange={(t) =>
          navigate(t === 'kundali' ? `/profiles/${id}` : `/profiles/${id}?tab=${t}`, {
            replace: true,
          })
        }
      />

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'kundali' && (
          <KundaliPanel
            profile={profile}
            kundaliId={kid}
            canManage={detail.data.access === 'owner'}
          />
        )}
        {tab === 'sessions' && (
          <SessionsPanel profileId={profile.id} latestKundali={latestKundali} />
        )}
        {tab === 'details' && <DetailsPanel data={detail.data} />}
      </div>
    </section>
  );
}

function Header({ data }: { data: ProfileDetail }) {
  const { profile } = data;
  const navigate = useNavigate();
  const toast = useToast();
  const del = useDeleteProfile();
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{profile.name}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarBlank size={14} aria-hidden />
            {formatDob(profile.dob)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={14} aria-hidden />
            {formatTob(profile.tob, profile.tobUnknown)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={14} aria-hidden />
            {profile.place}
          </span>
        </div>
      </div>
      {data.access === 'owner' ? (
        <div className="flex gap-2">
          <Link to={`/profiles/${profile.id}/edit`} className={buttonClass('secondary')}>
            <PencilSimple size={16} aria-hidden />
            Edit
          </Link>
          <Button variant="secondary" onClick={() => setSharing(true)}>
            <ShareNetwork size={16} aria-hidden />
            Share
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(true)} aria-label="Delete profile">
            <Trash size={16} aria-hidden />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      ) : (
        <p className="rounded-full bg-indigo-soft px-3 py-1 text-xs font-semibold text-indigo">
          Shared with you by {data.sharedBy}
        </p>
      )}
      <ShareDialog
        profileId={profile.id}
        profileName={profile.name}
        open={sharing}
        onClose={() => setSharing(false)}
      />
      <ConfirmDialog
        open={confirming}
        title={`Delete ${profile.name}?`}
        confirmLabel="Delete profile"
        busy={del.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          del.mutate(profile.id, {
            onSuccess: () => {
              toast.success(`Deleted ${profile.name}`);
              navigate('/');
            },
            onError: (e) => {
              setConfirming(false);
              toast.error(e.message);
            },
          })
        }
      >
        The profile, its kundalis and Q&amp;A sessions will no longer be shown.
      </ConfirmDialog>
    </div>
  );
}

function Tabs({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, i: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + TABS.length) % TABS.length;
    const tab = TABS[next];
    if (!tab) return;
    onChange(tab.id);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="Profile sections" className="flex gap-1 border-b border-border">
      {TABS.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${selected ? 'border-saffron text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function DetailsPanel({ data }: { data: ProfileDetail }) {
  const p = data.profile;
  const rows: [string, ReactNode][] = [
    ['Full name', p.name],
    ['Gender', GENDER_LABELS[p.gender]],
    ['Date of birth', formatDob(p.dob)],
    ['Time of birth', formatTob(p.tob, p.tobUnknown)],
    ['Place of birth', p.place],
    ['Coordinates', `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`],
    ['Time zone', p.tz],
    ['Notes', p.notes ? <span className="whitespace-pre-wrap">{p.notes}</span> : '—'],
  ];
  return (
    <dl className="divide-y divide-border rounded-xl border border-border bg-surface">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-3">
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="text-sm sm:col-span-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

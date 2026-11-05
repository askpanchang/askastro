import { UsersThree, X } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import {
  RELATIONS,
  RELATION_LABELS,
  isCouple,
  type Relation,
  type Session,
} from '../../../shared/session';
import { useProfiles } from '../../api/profiles';
import { useSessionPartner } from '../../api/sessions';
import { Modal } from '../Modal';
import { useToast } from '../Toaster';
import { Button, inputClass } from '../ui';

/**
 * The session's second person (max two charts): shown under the session
 * title, with a dialog to add, change or remove them.
 */
export function PartnerBar({
  session,
  ownerName,
  disabled,
}: {
  session: Session;
  ownerName: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useSessionPartner(session.id);
  const toast = useToast();
  const p = session.partner;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {p ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1">
            <UsersThree size={16} className="text-saffron" aria-hidden />
            With <strong>{p.name}</strong>
            <span className="text-muted">· {RELATION_LABELS[p.relation]}</span>
          </span>
          <Button variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
            Change
          </Button>
          <Button
            variant="ghost"
            disabled={disabled}
            loading={mutation.isPending && mutation.variables === null}
            onClick={() =>
              mutation.mutate(null, {
                onSuccess: () => toast.success(`Removed ${p.name} from this chat`),
                onError: (e) => toast.error(e.message),
              })
            }
            aria-label={`Remove ${p.name}`}
          >
            <X size={14} aria-hidden />
            Remove
          </Button>
        </>
      ) : (
        <Button variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
          <UsersThree size={16} aria-hidden />
          Add a second person
        </Button>
      )}
      <PartnerDialog
        session={session}
        ownerName={ownerName}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

function PartnerDialog({
  session,
  ownerName,
  open,
  onClose,
}: {
  session: Session;
  ownerName: string;
  open: boolean;
  onClose: () => void;
}) {
  const profiles = useProfiles('');
  const mutation = useSessionPartner(session.id);
  const toast = useToast();
  const [profileId, setProfileId] = useState(session.partner?.profileId ?? '');
  const [relation, setRelation] = useState<Relation>(session.partner?.relation ?? 'spouse');
  const [error, setError] = useState<string | null>(null);
  const options = (profiles.data?.pages.flatMap((pg) => pg.items) ?? []).filter(
    (p) => p.id !== session.profileId,
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!profileId) {
      setError('Choose a person');
      return;
    }
    setError(null);
    mutation.mutate(
      { profileId, relation },
      {
        onSuccess: ({ session: s }) => {
          toast.success(`Answers now use both charts: ${ownerName} and ${s.partner?.name ?? ''}`);
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <Modal open={open} title="Add a second person" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-muted">
          Both charts go into every answer in this chat, e.g. a spouse for marriage questions.
          Spouses and partners also get Guna Milan (Ashtakoota) matching.
        </p>
        <div className="space-y-1">
          <label htmlFor="partner-profile" className="text-sm font-medium">
            Person
          </label>
          <select
            id="partner-profile"
            className={inputClass}
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'partner-error' : undefined}
          >
            <option value="">{profiles.isPending ? 'Loading…' : 'Choose a profile'}</option>
            {options.map((p) => (
              <option key={p.id} value={p.id} disabled={p.kundaliStatus === 'none'}>
                {p.name}
                {p.kundaliStatus === 'none' ? ' (no kundali yet)' : ''}
              </option>
            ))}
          </select>
          {profiles.hasNextPage && (
            <button
              type="button"
              className="text-xs text-saffron hover:underline"
              onClick={() => void profiles.fetchNextPage()}
            >
              Show more profiles
            </button>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="partner-relation" className="text-sm font-medium">
            Their relationship to {ownerName}
          </label>
          <select
            id="partner-relation"
            className={inputClass}
            value={relation}
            onChange={(e) => setRelation(e.target.value as Relation)}
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {RELATION_LABELS[r]}
                {isCouple(r) ? ' · with Guna Milan' : ''}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p id="partner-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Use both charts
          </Button>
        </div>
      </form>
    </Modal>
  );
}

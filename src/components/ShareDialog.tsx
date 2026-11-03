import { Trash, UserPlus } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { ShareCreateSchema } from '../../shared/profile';
import { useAddShare, useRemoveShare, useShares } from '../api/profiles';
import { Modal } from './Modal';
import { useToast } from './Toaster';
import { Button, ErrorState, Spinner, inputClass } from './ui';

/** Owner-only: share a profile (view + Q&A) with family members by email. */
export function ShareDialog({
  profileId,
  profileName,
  open,
  onClose,
}: {
  profileId: string;
  profileName: string;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const shares = useShares(profileId, open);
  const add = useAddShare(profileId);
  const remove = useRemoveShare(profileId);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = ShareCreateSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
      return;
    }
    setError(null);
    add.mutate(parsed.data.email, {
      onSuccess: () => {
        setEmail('');
        toast.success(`Shared with ${parsed.data.email}`);
      },
      onError: (err) => setError(err.message),
    });
  }

  return (
    <Modal open={open} title={`Share ${profileName}`} onClose={onClose}>
      <p className="text-sm text-muted">
        People you add can see this profile and its kundali and ask their own questions. Their
        Q&amp;A sessions are private to them. They can't edit, regenerate or delete it.
      </p>
      <form
        onSubmit={submit}
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start"
        noValidate
      >
        <div className="flex-1 space-y-1">
          <label htmlFor="share-email" className="sr-only">
            Email address
          </label>
          <input
            id="share-email"
            type="email"
            autoComplete="off"
            placeholder="family.member@example.com"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? 'share-email-error' : undefined}
          />
          {error && (
            <p id="share-email-error" className="text-xs font-medium text-danger">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" loading={add.isPending}>
          <UserPlus size={16} aria-hidden />
          Share
        </Button>
      </form>

      <h3 className="mt-6 text-sm font-semibold">Shared with</h3>
      {shares.isPending ? (
        <Spinner />
      ) : shares.isError ? (
        <ErrorState message={shares.error.message} onRetry={() => void shares.refetch()} />
      ) : shares.data.items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Only you, so far.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
          {shares.data.items.map((s) => (
            <li key={s.email} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="truncate">{s.email}</span>
              <Button
                variant="ghost"
                aria-label={`Stop sharing with ${s.email}`}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(s.email, {
                    onSuccess: () => toast.success(`Stopped sharing with ${s.email}`),
                    onError: (err) => toast.error(err.message),
                  })
                }
              >
                <Trash size={16} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        They also need to be allowed to sign in: add their email to the Kundali Studio policy in
        Cloudflare Zero Trust (Access → Applications).
      </p>
    </Modal>
  );
}

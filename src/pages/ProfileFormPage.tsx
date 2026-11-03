import { MapPin } from '@phosphor-icons/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import {
  GENDER_LABELS,
  GENDERS,
  ProfileInputSchema,
  type Profile,
  type ProfileInput,
} from '../../shared/profile';
import { latestTodayIso, to12h } from '../../shared/validation';
import { ApiRequestError } from '../api/client';
import { useCreateProfile, useProfile, useUpdateProfile } from '../api/profiles';
import { BackLink } from '../components/BackLink';
import { PlaceAutocomplete } from '../components/PlaceAutocomplete';
import { useToast } from '../components/Toaster';
import { Button, ErrorState, Spinner, buttonClass, inputClass } from '../components/ui';

type FormState = {
  name: string;
  gender: string;
  dob: string;
  tob: string;
  tobUnknown: boolean;
  place: string;
  lat: string;
  lon: string;
  tz: string;
  notes: string;
};

type Errors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  name: '',
  gender: '',
  dob: '',
  tob: '',
  tobUnknown: false,
  place: '',
  lat: '',
  lon: '',
  tz: '',
  notes: '',
};

function fromProfile(p: Profile): FormState {
  return {
    name: p.name,
    gender: p.gender,
    dob: p.dob,
    tob: p.tob ?? '',
    tobUnknown: p.tobUnknown,
    place: p.place,
    lat: String(p.lat),
    lon: String(p.lon),
    tz: p.tz,
    notes: p.notes ?? '',
  };
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

function toInput(f: FormState): Record<string, unknown> {
  return {
    name: f.name,
    gender: f.gender || undefined,
    dob: f.dob,
    tob: f.tobUnknown ? null : f.tob || null,
    tobUnknown: f.tobUnknown,
    place: f.place,
    lat: num(f.lat),
    lon: num(f.lon),
    tz: f.tz,
    notes: f.notes.trim() || null,
  };
}

function firstErrors(fieldErrors: Record<string, string[] | undefined>): Errors {
  const out: Errors = {};
  for (const [k, v] of Object.entries(fieldErrors)) {
    if (v?.[0]) out[k as keyof FormState] = v[0];
  }
  return out;
}

function validateProfileForm(f: FormState) {
  const r = ProfileInputSchema.safeParse(toInput(f));
  if (r.success) return { ok: true as const, data: r.data };
  const errors = firstErrors(z.flattenError(r.error).fieldErrors);
  // Zod skips the cross-field time rule while other fields fail; show it anyway.
  if (!f.tobUnknown && !f.tob && !errors.tob) {
    errors.tob = 'Enter the time of birth or mark it unknown';
  }
  return { ok: false as const, errors };
}

let timeZones: string[] | null = null;
function allTimeZones(): string[] {
  if (!timeZones) {
    try {
      timeZones = Intl.supportedValuesOf('timeZone');
    } catch {
      timeZones = [];
    }
  }
  return timeZones;
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function ProfileForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  cancelTo,
}: {
  initial: FormState;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: ProfileInput) => Promise<void>;
  cancelTo: string;
}) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initial.lat));

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    const next = { ...f, [key]: value };
    setF(next);
    if (submitted) {
      const r = validateProfileForm(next);
      setErrors(r.ok ? {} : r.errors);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const r = validateProfileForm(f);
    if (!r.ok) {
      setErrors(r.errors);
      if (r.errors.lat || r.errors.lon || r.errors.tz) setAdvancedOpen(true);
      document.getElementById(`pf-${Object.keys(r.errors)[0]}`)?.focus();
      return;
    }
    setErrors({});
    try {
      await onSubmit(r.data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
        const details = err.details as { fieldErrors?: Record<string, string[]> } | undefined;
        setErrors(firstErrors(details?.fieldErrors ?? {}));
      }
      throw err;
    }
  }

  const err = (k: keyof FormState) => errors[k];
  const describedBy = (k: keyof FormState) => (errors[k] ? `pf-${k}-error` : `pf-${k}-hint`);
  const hasCoords = f.lat !== '' && f.lon !== '' && f.tz !== '';

  return (
    <form onSubmit={(e) => void handleSubmit(e).catch(() => {})} noValidate className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id="pf-name" label="Full name" error={err('name')}>
            <input
              id="pf-name"
              className={inputClass}
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={!!err('name') || undefined}
              aria-describedby={describedBy('name')}
              autoComplete="off"
            />
          </Field>
        </div>

        <fieldset className="space-y-1 sm:col-span-2">
          <legend className="text-sm font-medium">Gender</legend>
          <div className="flex flex-wrap gap-2" id="pf-gender" tabIndex={-1}>
            {GENDERS.map((g) => (
              <label
                key={g}
                className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-saffron ${f.gender === g ? 'border-saffron bg-saffron-soft font-semibold' : 'border-border bg-surface'}`}
              >
                <input
                  type="radio"
                  name="gender"
                  value={g}
                  checked={f.gender === g}
                  onChange={() => set('gender', g)}
                  className="sr-only"
                />
                {GENDER_LABELS[g]}
              </label>
            ))}
          </div>
          {err('gender') && <p className="text-xs font-medium text-danger">{err('gender')}</p>}
        </fieldset>

        <Field id="pf-dob" label="Date of birth" error={err('dob')}>
          <input
            id="pf-dob"
            type="date"
            className={inputClass}
            value={f.dob}
            max={latestTodayIso()}
            min="1800-01-01"
            onChange={(e) => set('dob', e.target.value)}
            aria-invalid={!!err('dob') || undefined}
            aria-describedby={describedBy('dob')}
          />
        </Field>

        <div className="space-y-2">
          <Field
            id="pf-tob"
            label="Time of birth"
            error={err('tob')}
            hint={
              f.tob && !f.tobUnknown
                ? `${f.tob} (24-hour) · ${to12h(f.tob)}`
                : 'Local time at the place of birth'
            }
          >
            <input
              id="pf-tob"
              type="time"
              className={inputClass}
              value={f.tobUnknown ? '' : f.tob}
              disabled={f.tobUnknown}
              onChange={(e) => set('tob', e.target.value)}
              aria-invalid={!!err('tob') || undefined}
              aria-describedby={describedBy('tob')}
            />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.tobUnknown}
              onChange={(e) => set('tobUnknown', e.target.checked)}
              className="h-4 w-4 accent-saffron"
            />
            Time of birth unknown
          </label>
          {f.tobUnknown && (
            <p className="rounded-lg bg-saffron-soft px-3 py-2 text-xs">
              The chart will use 12:00 noon. Ascendant and house-based readings will be unreliable.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <Field
            id="pf-place"
            label="Place of birth"
            error={err('place')}
            hint={
              hasCoords ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} aria-hidden />
                  {Number(f.lat).toFixed(4)}, {Number(f.lon).toFixed(4)} · {f.tz}
                </span>
              ) : (
                'Pick a result to fill coordinates and time zone'
              )
            }
          >
            <PlaceAutocomplete
              id="pf-place"
              value={f.place}
              invalid={!!err('place')}
              describedBy={describedBy('place')}
              onChange={(text) => set('place', text)}
              onSelect={(p) => {
                const next = {
                  ...f,
                  place: p.label,
                  lat: String(p.lat),
                  lon: String(p.lon),
                  tz: p.tz,
                };
                setF(next);
                if (submitted) {
                  const r = validateProfileForm(next);
                  setErrors(r.ok ? {} : r.errors);
                }
              }}
            />
          </Field>
        </div>

        <details
          className="rounded-xl border border-border bg-surface p-4 sm:col-span-2"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-sm font-medium">
            Coordinates and time zone{' '}
            {(err('lat') || err('lon') || err('tz')) && (
              <span className="text-danger">(needs attention)</span>
            )}
          </summary>
          <p className="mt-2 text-xs text-muted">
            Filled from the place search. Edit them for places the search doesn't know.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field id="pf-lat" label="Latitude" error={err('lat')}>
              <input
                id="pf-lat"
                inputMode="decimal"
                className={inputClass}
                value={f.lat}
                onChange={(e) => set('lat', e.target.value)}
                placeholder="17.3850"
                aria-invalid={!!err('lat') || undefined}
                aria-describedby={describedBy('lat')}
              />
            </Field>
            <Field id="pf-lon" label="Longitude" error={err('lon')}>
              <input
                id="pf-lon"
                inputMode="decimal"
                className={inputClass}
                value={f.lon}
                onChange={(e) => set('lon', e.target.value)}
                placeholder="78.4867"
                aria-invalid={!!err('lon') || undefined}
                aria-describedby={describedBy('lon')}
              />
            </Field>
            <Field id="pf-tz" label="Time zone (IANA)" error={err('tz')}>
              <input
                id="pf-tz"
                list="pf-tz-list"
                className={inputClass}
                value={f.tz}
                onChange={(e) => set('tz', e.target.value)}
                placeholder="Asia/Kolkata"
                aria-invalid={!!err('tz') || undefined}
                aria-describedby={describedBy('tz')}
              />
              <datalist id="pf-tz-list">
                {allTimeZones().map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </Field>
          </div>
        </details>

        <div className="sm:col-span-2">
          <Field id="pf-notes" label="Notes (optional)" error={err('notes')}>
            <textarea
              id="pf-notes"
              rows={3}
              className={inputClass}
              value={f.notes}
              onChange={(e) => set('notes', e.target.value)}
              aria-invalid={!!err('notes') || undefined}
              aria-describedby={describedBy('notes')}
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link to={cancelTo} className={buttonClass('secondary')}>
          Cancel
        </Link>
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function errorMessage(err: unknown) {
  if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
    return 'Please fix the highlighted fields.';
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function NewProfilePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateProfile();
  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <BackLink to="/">Profiles</BackLink>
      <h1 className="text-3xl font-bold">New profile</h1>
      <ProfileForm
        initial={EMPTY}
        submitLabel="Create profile"
        busy={create.isPending}
        cancelTo="/"
        onSubmit={async (input) => {
          try {
            const { profile } = await create.mutateAsync(input);
            toast.success(`Created ${profile.name}`);
            navigate(`/profiles/${profile.id}`);
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </section>
  );
}

export function EditProfilePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const detail = useProfile(id);
  const update = useUpdateProfile(id);

  if (detail.isPending) return <Spinner />;
  if (detail.isError) {
    return <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />;
  }
  const { profile } = detail.data;

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <BackLink to={`/profiles/${id}`}>{profile.name}</BackLink>
      <h1 className="text-3xl font-bold">Edit profile</h1>
      <ProfileForm
        key={profile.updatedAt}
        initial={fromProfile(profile)}
        submitLabel="Save changes"
        busy={update.isPending}
        cancelTo={`/profiles/${id}`}
        onSubmit={async (input) => {
          try {
            await update.mutateAsync(input);
            toast.success('Profile saved');
            navigate(`/profiles/${id}`);
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </section>
  );
}

import {
  CalendarBlank,
  Clock,
  MagnifyingGlass,
  MapPin,
  Plus,
  UsersThree,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useProfiles } from '../api/profiles';
import { KundaliStatusBadge } from '../components/KundaliStatusBadge';
import { Button, EmptyState, ErrorState, Spinner, buttonClass, inputClass } from '../components/ui';
import { formatDob, formatRelative, formatTob } from '../lib/format';
import { useDebouncedValue } from '../lib/useDebouncedValue';

export function ProfilesListPage() {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const list = useProfiles(q);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Profiles</h1>
        <Link to="/profiles/new" className={buttonClass('primary')}>
          <Plus size={16} weight="bold" aria-hidden />
          New profile
        </Link>
      </div>

      <div className="relative max-w-md">
        <label htmlFor="profile-search" className="sr-only">
          Search profiles by name
        </label>
        <MagnifyingGlass
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          id="profile-search"
          type="search"
          placeholder="Search by name"
          className={`${inputClass} pl-9`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {list.isPending ? (
        <Spinner label="Loading profiles…" />
      ) : list.isError ? (
        <ErrorState message="Couldn't load profiles." onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        q ? (
          <EmptyState title="No matches">
            <p className="text-sm text-muted">No profile names contain “{q}”.</p>
          </EmptyState>
        ) : (
          <EmptyState icon={<UsersThree size={40} aria-hidden />} title="No profiles yet">
            <p className="max-w-sm text-sm text-muted">
              Add someone's birth details to generate their kundali and ask questions about it.
            </p>
            <Link to="/profiles/new" className={buttonClass('primary')}>
              <Plus size={16} weight="bold" aria-hidden />
              Create the first profile
            </Link>
          </EmptyState>
        )
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/profiles/${p.id}`}
                  className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-saffron hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-display text-lg font-semibold">{p.name}</h2>
                    <KundaliStatusBadge status={p.kundaliStatus} />
                  </div>
                  <dl className="space-y-1 text-sm text-muted">
                    <div className="flex items-center gap-2">
                      <dt className="sr-only">Born</dt>
                      <CalendarBlank size={14} aria-hidden />
                      <dd>
                        {formatDob(p.dob)} · {formatTob(p.tob, p.tobUnknown)}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="sr-only">Place</dt>
                      <MapPin size={14} aria-hidden />
                      <dd className="truncate">{p.place}</dd>
                    </div>
                    {p.lastSessionAt && (
                      <div className="flex items-center gap-2">
                        <dt className="sr-only">Last Q&amp;A</dt>
                        <Clock size={14} aria-hidden />
                        <dd>Last Q&amp;A {formatRelative(p.lastSessionAt)}</dd>
                      </div>
                    )}
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

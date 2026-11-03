import { CircleNotch, MapPin } from '@phosphor-icons/react';
import { useId, useState, type KeyboardEvent } from 'react';
import type { Place } from '../../shared/geocode';
import { useGeocode } from '../api/geocode';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { inputClass } from './ui';

/** Accessible combobox: type a place, pick a result to fill lat/lon/tz. */
export function PlaceAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (text: string) => void;
  onSelect: (place: Place) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebouncedValue(value, 300);
  const search = useGeocode(open ? debounced : '');
  const results = search.data?.results ?? [];
  const showList = open && debounced.trim().length >= 2;

  function choose(p: Place) {
    onSelect(p);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && showList && active >= 0 && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={inputClass}
        placeholder="Start typing a city, e.g. Hyderabad"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {search.isFetching && showList && (
        <CircleNotch
          size={16}
          className="absolute top-3 right-3 animate-spin text-muted"
          aria-hidden
        />
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {search.isError && <li className="px-3 py-2 text-sm text-danger">Place search failed</li>}
          {!search.isError && !search.isFetching && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">
              No matches. You can enter coordinates manually below.
            </li>
          )}
          {results.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
              className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${i === active ? 'bg-saffron-soft' : 'hover:bg-surface-2'}`}
            >
              <MapPin size={16} className="mt-0.5 shrink-0 text-saffron" aria-hidden />
              <span>
                <span className="font-medium">{p.label}</span>
                <span className="block text-xs text-muted">
                  {p.lat.toFixed(4)}, {p.lon.toFixed(4)} · {p.tz}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

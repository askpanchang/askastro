import { useState } from 'react';
import {
  AYANAMSA_LABELS,
  AYANAMSAS,
  CHART_STYLES,
  LANG_LABELS,
  LANGS,
  type KundaliOptions,
} from '../../../shared/kundali';
import { Button, inputClass } from '../ui';

export function GenerateKundaliForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<KundaliOptions>;
  busy: boolean;
  submitLabel: string;
  onSubmit: (o: KundaliOptions) => void;
  onCancel?: () => void;
}) {
  const [o, setO] = useState<KundaliOptions>({
    ayanamsa: 'lahiri',
    chartStyle: 'north',
    lang: 'en',
    ...initial,
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(o);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="ko-ayan" className="block text-sm font-medium">
            Ayanamsa
          </label>
          <select
            id="ko-ayan"
            className={inputClass}
            value={o.ayanamsa}
            onChange={(e) => setO({ ...o, ayanamsa: e.target.value as KundaliOptions['ayanamsa'] })}
          >
            {AYANAMSAS.map((a) => (
              <option key={a} value={a}>
                {AYANAMSA_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Chart style</legend>
          <div className="flex gap-2">
            {CHART_STYLES.map((s) => (
              <label
                key={s}
                className={`inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-saffron ${o.chartStyle === s ? 'border-saffron bg-saffron-soft font-semibold' : 'border-border bg-surface'}`}
              >
                <input
                  type="radio"
                  name="ko-style"
                  value={s}
                  checked={o.chartStyle === s}
                  onChange={() => setO({ ...o, chartStyle: s })}
                  className="sr-only"
                />
                {s === 'north' ? 'North' : 'South'}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1">
          <label htmlFor="ko-lang" className="block text-sm font-medium">
            Q&amp;A language
          </label>
          <select
            id="ko-lang"
            className={inputClass}
            value={o.lang}
            onChange={(e) => setO({ ...o, lang: e.target.value as KundaliOptions['lang'] })}
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy}>
          {busy ? 'Generating…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

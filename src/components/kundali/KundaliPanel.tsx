import { ArrowsClockwise, Sparkle, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CHART_NAMES, planetName } from '../../../shared/astro';
import { availableCharts, toChartHouses } from '../../../shared/chartModel';
import { AYANAMSA_LABELS, type KundaliDetail } from '../../../shared/kundali';
import type { Profile } from '../../../shared/profile';
import { useGenerateKundali, useKundali, useKundaliVersions } from '../../api/kundali';
import { dateTime } from '../../lib/dates';
import { Modal } from '../Modal';
import { useToast } from '../Toaster';
import { Button, EmptyState, ErrorState, Spinner, inputClass } from '../ui';
import { ChartNorth } from './ChartNorth';
import { ChartSouth } from './ChartSouth';
import { DashaTimeline } from './DashaTimeline';
import { GenerateKundaliForm } from './GenerateKundaliForm';
import { HouseTable } from './HouseTable';
import { KundaliSummary } from './KundaliSummary';
import { PlanetTable } from './PlanetTable';
import { YogaDoshaList } from './YogaDoshaList';

/** Kundali tab content: generate, view a version, switch versions, regenerate. */
export function KundaliPanel({
  profile,
  kundaliId,
  canManage = true,
}: {
  profile: Profile;
  kundaliId?: string;
  /** Owner only: generate and regenerate. People it's shared with just view. */
  canManage?: boolean;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const versions = useKundaliVersions(profile.id);
  const generate = useGenerateKundali(profile.id);
  const [regenOpen, setRegenOpen] = useState(false);

  const latest = versions.data?.items[0];
  const selectedId = kundaliId ?? latest?.id;
  const detail = useKundali(selectedId);

  function run(options: Parameters<typeof generate.mutate>[0]) {
    generate.mutate(options, {
      onSuccess: (k) => {
        setRegenOpen(false);
        toast.success('Kundali generated');
        navigate(`/profiles/${profile.id}`, { replace: Boolean(kundaliId) });
        void k;
      },
      onError: (e) => toast.error(e.message),
    });
  }

  if (versions.isPending) return <Spinner label="Loading kundali…" />;
  if (versions.isError) {
    return <ErrorState message={versions.error.message} onRetry={() => void versions.refetch()} />;
  }

  if (!latest && !canManage) {
    return (
      <EmptyState icon={<Sparkle size={40} aria-hidden />} title="No kundali yet">
        <p className="max-w-md text-sm text-muted">
          The owner hasn't generated {profile.name}'s kundali yet.
        </p>
      </EmptyState>
    );
  }

  if (!latest) {
    return (
      <EmptyState icon={<Sparkle size={40} aria-hidden />} title="No kundali yet">
        <p className="max-w-md text-sm text-muted">
          Generate {profile.name}'s birth chart from the AskPanchang Kundali API. It takes a few
          seconds.
        </p>
        {profile.tobUnknown && <TimeUncertainNote />}
        <div className="w-full max-w-xl text-left">
          <GenerateKundaliForm
            busy={generate.isPending}
            submitLabel="Generate kundali"
            onSubmit={run}
          />
        </div>
        {generate.isError && (
          <p role="alert" className="text-sm text-danger">
            {generate.error.message}
          </p>
        )}
      </EmptyState>
    );
  }

  const items = versions.data.items;
  const selectedVersion = items.find((v) => v.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <label htmlFor="kundali-version" className="block text-xs font-medium text-muted">
            Version
          </label>
          <select
            id="kundali-version"
            className={`${inputClass} w-auto min-w-64`}
            value={selectedId}
            onChange={(e) =>
              navigate(
                e.target.value === latest.id
                  ? `/profiles/${profile.id}`
                  : `/profiles/${profile.id}/kundali/${e.target.value}`,
              )
            }
          >
            {items.map((v, i) => (
              <option key={v.id} value={v.id}>
                {dateTime(v.createdAt)} · {AYANAMSA_LABELS[v.ayanamsa as 'lahiri'] ?? v.ayanamsa}
                {i === 0 ? ' (latest)' : ''}
                {v.stale ? ' · outdated' : ''}
              </option>
            ))}
          </select>
        </div>
        {canManage && (
          <Button variant="secondary" onClick={() => setRegenOpen(true)}>
            <ArrowsClockwise size={16} aria-hidden />
            Regenerate
          </Button>
        )}
      </div>

      {selectedVersion && selectedVersion.id !== latest.id && (
        <p className="rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm">
          You're viewing an older version.{' '}
          <button
            type="button"
            className="font-semibold text-saffron underline-offset-4 hover:underline"
            onClick={() => navigate(`/profiles/${profile.id}`)}
          >
            Show latest
          </button>
        </p>
      )}

      {detail.isPending ? (
        <Spinner label="Loading chart…" />
      ) : detail.isError ? (
        <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
      ) : (
        <KundaliBody kundali={detail.data} tz={profile.tz} />
      )}

      <Modal open={regenOpen} title="Regenerate kundali" onClose={() => setRegenOpen(false)}>
        <p className="mb-4 text-sm text-muted">
          Creates a new version from the current birth details. Older versions and the Q&amp;A
          sessions asked against them are kept.
        </p>
        <GenerateKundaliForm
          initial={
            detail.data
              ? {
                  ayanamsa: detail.data.ayanamsa as 'lahiri',
                  chartStyle: detail.data.chartStyle,
                  lang: detail.data.lang as 'en',
                }
              : undefined
          }
          busy={generate.isPending}
          submitLabel="Generate new version"
          onSubmit={run}
          onCancel={() => setRegenOpen(false)}
        />
      </Modal>
    </div>
  );
}

function TimeUncertainNote() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber/40 bg-saffron-soft px-4 py-3 text-left text-sm">
      <Warning size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
      Birth time is unknown, so the chart is cast for 12:00 noon. The ascendant, houses and
      house-based readings are unreliable; Moon sign and planetary positions by sign are still
      useful.
    </p>
  );
}

function KundaliBody({ kundali, tz }: { kundali: KundaliDetail; tz: string }) {
  const { data } = kundali;
  const charts = availableCharts(data);
  const [chart, setChart] = useState('D1');
  const [style, setStyle] = useState(kundali.chartStyle);
  const houses = toChartHouses(data, chart) ?? toChartHouses(data, 'D1');
  const title = CHART_NAMES[chart] ?? chart;
  const r = data.readings;

  return (
    <div className="space-y-8">
      {kundali.timeUncertain && <TimeUncertainNote />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <section aria-labelledby="chart-heading" className="space-y-3">
          <h2 id="chart-heading" className="sr-only">
            Chart
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="chart-select" className="sr-only">
              Divisional chart
            </label>
            <select
              id="chart-select"
              className={`${inputClass} w-auto`}
              value={chart}
              onChange={(e) => setChart(e.target.value)}
            >
              {charts.map((c) => (
                <option key={c} value={c}>
                  {CHART_NAMES[c] ?? c}
                </option>
              ))}
            </select>
            <div
              role="group"
              aria-label="Chart style"
              className="inline-flex rounded-lg border border-border p-0.5"
            >
              {(['north', 'south'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={style === s}
                  onClick={() => setStyle(s)}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${style === s ? 'bg-saffron text-on-accent' : 'text-muted hover:text-text'}`}
                >
                  {s === 'north' ? 'North' : 'South'}
                </button>
              ))}
            </div>
          </div>
          {houses && (
            <div className="rounded-xl border border-border bg-surface p-3">
              {style === 'north' ? (
                <ChartNorth houses={houses} title={title} />
              ) : (
                <ChartSouth houses={houses} title={title} />
              )}
            </div>
          )}
          <p className="text-xs text-muted">
            Degrees shown in D1 only. R = retrograde. Numbers in the North chart are sign numbers (1
            = Aries).
          </p>
        </section>

        <section aria-labelledby="summary-heading" className="space-y-4">
          <h2 id="summary-heading" className="text-xl font-semibold">
            Summary
          </h2>
          <KundaliSummary data={data} tz={tz} />
          {r && (r.lagna || r.moon || r.nak || r.dasha) && (
            <div className="space-y-2 text-sm leading-relaxed">
              {[r.lagna, r.moon, r.nak, r.dasha].filter(Boolean).map((t) => (
                <p key={t}>{t}</p>
              ))}
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="planets-heading" className="space-y-3">
        <h2 id="planets-heading" className="text-xl font-semibold">
          Planetary positions
        </h2>
        <PlanetTable data={data} />
        {r && r.planets.length > 0 && (
          <details className="rounded-xl border border-border bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Planet readings</summary>
            <ul className="mt-3 space-y-2">
              {r.planets.map((p) => (
                <li key={p.p}>
                  <span className="font-semibold">{planetName(p.p)}: </span>
                  {p.txt}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="houses-heading" className="space-y-3">
        <h2 id="houses-heading" className="text-xl font-semibold">
          Houses
        </h2>
        <HouseTable data={data} />
      </section>

      <section aria-labelledby="dasha-heading" className="space-y-3">
        <h2 id="dasha-heading" className="text-xl font-semibold">
          Vimshottari dasha
        </h2>
        <DashaTimeline data={data} tz={tz} />
      </section>

      <section aria-labelledby="yogas-heading" className="space-y-3">
        <h2 id="yogas-heading" className="sr-only">
          Yogas and doshas
        </h2>
        <YogaDoshaList data={data} />
      </section>
    </div>
  );
}

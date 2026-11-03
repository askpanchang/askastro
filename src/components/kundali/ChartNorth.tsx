import type { ChartHouse } from '../../../shared/chartModel';
import { chartAriaLabel, planetLabel } from './chartText';

type Pt = [number, number];

/** House polygons in a 400×400 North Indian (diamond) chart; house 1 at the top. */
const POLYS: Record<number, Pt[]> = {
  1: [
    [200, 0],
    [300, 100],
    [200, 200],
    [100, 100],
  ],
  2: [
    [0, 0],
    [200, 0],
    [100, 100],
  ],
  3: [
    [0, 0],
    [100, 100],
    [0, 200],
  ],
  4: [
    [0, 200],
    [100, 100],
    [200, 200],
    [100, 300],
  ],
  5: [
    [0, 200],
    [100, 300],
    [0, 400],
  ],
  6: [
    [0, 400],
    [100, 300],
    [200, 400],
  ],
  7: [
    [200, 400],
    [100, 300],
    [200, 200],
    [300, 300],
  ],
  8: [
    [200, 400],
    [300, 300],
    [400, 400],
  ],
  9: [
    [400, 400],
    [300, 300],
    [400, 200],
  ],
  10: [
    [400, 200],
    [300, 300],
    [200, 200],
    [300, 100],
  ],
  11: [
    [400, 200],
    [300, 100],
    [400, 0],
  ],
  12: [
    [400, 0],
    [300, 100],
    [200, 0],
  ],
};

/** Where planet text is centred, and where the sign number sits (near the inner corner). */
const LAYOUT: Record<number, { c: Pt; sign: Pt; tri: boolean }> = {
  1: { c: [200, 95], sign: [200, 182], tri: false },
  2: { c: [100, 38], sign: [100, 86], tri: true },
  3: { c: [36, 100], sign: [84, 104], tri: true },
  4: { c: [100, 195], sign: [182, 204], tri: false },
  5: { c: [36, 300], sign: [84, 304], tri: true },
  6: { c: [100, 360], sign: [100, 322], tri: true },
  7: { c: [200, 300], sign: [200, 226], tri: false },
  8: { c: [300, 360], sign: [300, 322], tri: true },
  9: { c: [364, 300], sign: [316, 304], tri: true },
  10: { c: [300, 195], sign: [218, 204], tri: false },
  11: { c: [364, 100], sign: [316, 104], tri: true },
  12: { c: [300, 38], sign: [300, 86], tri: true },
};

export function ChartNorth({ houses, title }: { houses: ChartHouse[]; title: string }) {
  return (
    <svg
      viewBox="-4 -4 408 408"
      className="h-auto w-full max-w-[28rem] select-none"
      role="img"
      aria-label={chartAriaLabel(houses, title)}
    >
      {houses.map((h) => {
        const poly = POLYS[h.house];
        const lay = LAYOUT[h.house];
        if (!poly || !lay) return null;
        const items = h.asc ? ['Asc', ...h.planets.map(planetLabel)] : h.planets.map(planetLabel);
        const perLine = lay.tri ? (items.length > 4 ? 2 : 1) : items.length > 4 ? 2 : 1;
        const lines: string[][] = [];
        for (let i = 0; i < items.length; i += perLine) lines.push(items.slice(i, i + perLine));
        const fs = lay.tri && items.length > 4 ? 10 : 12;
        const lh = fs + 2;
        const y0 = lay.c[1] - ((lines.length - 1) * lh) / 2;
        return (
          <g key={h.house}>
            <polygon
              points={poly.map((p) => p.join(',')).join(' ')}
              className={h.asc ? 'fill-saffron-soft stroke-saffron' : 'fill-surface stroke-border'}
              strokeWidth={h.asc ? 2 : 1.5}
              strokeLinejoin="round"
            />
            <text
              x={lay.sign[0]}
              y={lay.sign[1]}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted"
              fontSize={11}
            >
              {h.sign}
            </text>
            {lines.map((line, i) => (
              <text
                key={i}
                x={lay.c[0]}
                y={y0 + i * lh}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={fs}
                className="fill-text font-semibold"
              >
                {line.map((t, j) => (
                  <tspan key={j} className={t === 'Asc' ? 'fill-saffron' : undefined}>
                    {j ? ' ' : ''}
                    {t}
                  </tspan>
                ))}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

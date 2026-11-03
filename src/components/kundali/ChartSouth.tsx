import { signName } from '../../../shared/astro';
import type { ChartHouse } from '../../../shared/chartModel';
import { chartAriaLabel, planetLabel } from './chartText';

/** Fixed sign positions (column, row) in the 4×4 South Indian grid; Pisces top-left. */
const CELL: Record<number, [number, number]> = {
  12: [0, 0],
  1: [1, 0],
  2: [2, 0],
  3: [3, 0],
  4: [3, 1],
  5: [3, 2],
  6: [3, 3],
  7: [2, 3],
  8: [1, 3],
  9: [0, 3],
  10: [0, 2],
  11: [0, 1],
};
const S = 100;

export function ChartSouth({ houses, title }: { houses: ChartHouse[]; title: string }) {
  return (
    <svg
      viewBox="-4 -4 408 408"
      className="h-auto w-full max-w-[28rem] select-none"
      role="img"
      aria-label={chartAriaLabel(houses, title)}
    >
      <rect x={S} y={S} width={2 * S} height={2 * S} className="fill-surface-2 stroke-border" />
      <text
        x={2 * S}
        y={2 * S}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-muted font-display"
        fontSize={15}
      >
        {title}
      </text>
      {houses.map((h) => {
        const cell = CELL[h.sign];
        if (!cell) return null;
        const [cx, cy] = cell;
        const x = cx * S;
        const y = cy * S;
        const items = h.planets.map(planetLabel);
        const perLine = items.length > 4 ? 2 : 1;
        const lines: string[][] = [];
        for (let i = 0; i < items.length; i += perLine) lines.push(items.slice(i, i + perLine));
        const fs = items.length > 4 ? 10 : 12;
        const lh = fs + 2;
        const y0 = y + 56 - ((lines.length - 1) * lh) / 2;
        return (
          <g key={h.sign}>
            <rect
              x={x}
              y={y}
              width={S}
              height={S}
              className={h.asc ? 'fill-saffron-soft stroke-saffron' : 'fill-surface stroke-border'}
              strokeWidth={h.asc ? 2 : 1.5}
            />
            {h.asc && (
              <line
                x1={x}
                y1={y + 22}
                x2={x + 22}
                y2={y}
                className="stroke-saffron"
                strokeWidth={2}
              />
            )}
            <text x={x + S - 6} y={y + 14} textAnchor="end" fontSize={10} className="fill-muted">
              {signName(h.sign).slice(0, 3)} · {h.house}
            </text>
            {h.asc && (
              <text x={x + 6} y={y + 34} fontSize={11} className="fill-saffron font-semibold">
                Asc
              </text>
            )}
            {lines.map((line, i) => (
              <text
                key={i}
                x={x + S / 2}
                y={y0 + i * lh}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={fs}
                className="fill-text font-semibold"
              >
                {line.join(' ')}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

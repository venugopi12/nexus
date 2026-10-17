import { useCallback } from 'react';
import { EChart } from '@/components/EChart';
import { seriesColor } from '@/lib/chartTheme';
import { fmtDateTime } from '@/lib/format';

export interface Series {
  name: string;
  points: { t: number; v: number | null }[];
  color?: string;
  area?: boolean;
  dashed?: boolean;
}
export interface TimeWindow { from: number; to: number; label?: string; tone?: 'selection' | 'incident' }

interface Props {
  series: Series[];
  format: (v: number) => string;
  height?: number;
  from?: number;
  to?: number;
  windows?: TimeWindow[];
  onBrush?: (range: [number, number]) => void;
  onHover?: (t: number | null) => void;
  ariaLabel: string;
  yMin?: number;
  yMax?: number;
  yName?: string;
}

/** Line/area chart: ≤8 categorical series, legend whenever ≥2 series, thin 1.5px lines, crosshair tooltip. */
export function TimeSeriesChart({ series, format, height = 220, from, to, windows, onBrush, onHover, ariaLabel, yMin, yMax }: Props) {
  const build = useCallback(
    (base: Record<string, unknown>) => {
      const marks = (windows ?? []).map((w) => [
        { xAxis: w.from, itemStyle: { color: w.tone === 'incident' ? 'rgba(245,100,114,0.08)' : 'rgba(110,107,245,0.14)' } },
        { xAxis: w.to },
      ]);
      return {
        ...base,
        legend: series.length > 1 ? (base.legend as object) : { show: false },
        grid: { ...(base.grid as object), top: series.length > 1 ? 30 : 12 },
        tooltip: {
          ...(base.tooltip as object),
          formatter: (params: { axisValue: number; marker: string; seriesName: string; value: [number, number | null] }[]) => {
            const rows = params
              .filter((p) => p.value[1] !== null && p.value[1] !== undefined)
              .map((p) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${p.seriesName}</span><b style="font-variant-numeric:tabular-nums">${format(p.value[1] as number)}</b></div>`)
              .join('');
            return `<div style="font-size:11px;opacity:.7;margin-bottom:4px">${fmtDateTime(params[0]?.axisValue ?? 0)}</div>${rows}`;
          },
        },
        xAxis: { ...(base.xAxis as object), min: from, max: to },
        yAxis: { ...(base.yAxis as object), min: yMin, max: yMax, axisLabel: { ...((base.yAxis as { axisLabel: object }).axisLabel), formatter: (v: number) => format(v) } },
        series: series.map((s, i) => {
          const color = s.color ?? seriesColor(i);
          return {
            name: s.name,
            type: 'line',
            showSymbol: false,
            symbolSize: 6,
            smooth: false,
            connectNulls: false,
            sampling: 'lttb',
            lineStyle: { width: 1.5, color, type: s.dashed ? 'dashed' : 'solid' },
            itemStyle: { color },
            emphasis: { focus: 'series', lineStyle: { width: 2 } },
            areaStyle: s.area ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}40` }, { offset: 1, color: `${color}00` }] } } : undefined,
            data: s.points.map((p) => [p.t, p.v]),
            markArea: i === 0 && marks.length ? { silent: true, data: marks } : undefined,
          };
        }),
      };
    },
    [series, format, from, to, windows, yMin, yMax],
  );
  return <EChart build={build} height={height} ariaLabel={ariaLabel} brush={!!onBrush} onBrush={onBrush} onHover={onHover} />;
}

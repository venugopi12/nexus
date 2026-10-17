import { memo, useEffect, useRef } from 'react';
import type { EChartsType } from '@/lib/echarts';
import { useUi } from '@/stores/ui';
import { cn } from '@/lib/utils';

interface Props {
  /** called with the theme-merged base so callers only describe their data */
  build: (base: Record<string, unknown>) => Record<string, unknown>;
  className?: string;
  height?: number | string;
  onReady?: (chart: EChartsType) => void;
  onBrush?: (range: [number, number]) => void;
  onClick?: (params: { seriesName?: string; value?: unknown; data?: unknown }) => void;
  onHover?: (t: number | null) => void;
  ariaLabel: string;
  /** enable drag-to-select time brush */
  brush?: boolean;
}

/** Thin imperative wrapper: lazy-loads ECharts, resizes with its container, disposes on unmount. */
export const EChart = memo(function EChart({ build, className, height = 220, onReady, onBrush, onClick, onHover, ariaLabel, brush }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const theme = useUi((s) => s.theme);
  const latest = useRef({ build, onBrush, onClick, onHover });
  latest.current = { build, onBrush, onClick, onHover };
  const optionKey = useRef(0);

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | undefined;
    (async () => {
      const [{ echarts }, { baseOption }] = await Promise.all([import('@/lib/echarts'), import('@/lib/chartTheme')]);
      if (disposed || !ref.current) return;
      const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
      chartRef.current = chart;
      chart.setOption(latest.current.build(baseOption()) as never);
      if (brush) {
        chart.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
        chart.on('brushEnd', (p: unknown) => {
          const area = (p as { areas?: { coordRange?: [number, number] }[] }).areas?.[0]?.coordRange;
          if (area) {
            latest.current.onBrush?.([Math.round(area[0]), Math.round(area[1])]);
            chart.dispatchAction({ type: 'brush', areas: [] });
          }
        });
      }
      chart.on('click', (p) => latest.current.onClick?.(p as never));
      chart.on('updateAxisPointer', (p: unknown) => {
        const t = (p as { axesInfo?: { value: number }[] }).axesInfo?.[0]?.value;
        latest.current.onHover?.(typeof t === 'number' ? t : null);
      });
      chart.getZr().on('globalout', () => latest.current.onHover?.(null));
      onReady?.(chart);
      ro = new ResizeObserver(() => chart.resize());
      ro.observe(ref.current);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
    // re-create on theme change so axis/tooltip colours are re-read from CSS variables
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, brush]);

  // cheap in-place updates when data changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    void import('@/lib/chartTheme').then(({ baseOption }) => {
      if (chartRef.current !== chart) return;
      optionKey.current++;
      chart.setOption(latest.current.build(baseOption()) as never, { notMerge: false, lazyUpdate: true, replaceMerge: ['series'] });
    });
  }, [build]);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={cn('w-full', className)} style={{ height }} />;
});

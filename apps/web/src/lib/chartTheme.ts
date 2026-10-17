/** Categorical series colours, assigned in fixed order. Status colours are never used for series. */
export const SERIES = ['#6e6bf5', '#38bdf8', '#c084fc', '#f472b6', '#94a3b8', '#818cf8', '#22d3ee', '#e879f9'];
export const seriesColor = (i: number) => SERIES[i % SERIES.length]!;

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function baseOption() {
  const text = cssVar('--chart-text') || '#8189a0';
  const grid = cssVar('--chart-grid') || '#1c202c';
  const popover = cssVar('--popover') || '#12141b';
  const border = cssVar('--border-strong') || '#2b3042';
  const fg = cssVar('--foreground') || '#e9ebf2';
  return {
    animation: true,
    animationDuration: 280,
    animationDurationUpdate: 200,
    textStyle: { fontFamily: 'Inter Variable, system-ui, sans-serif', color: text },
    grid: { left: 8, right: 12, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: popover,
      borderColor: border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: fg, fontSize: 12 },
      extraCssText: 'box-shadow:0 10px 30px -8px rgba(0,0,0,.5);border-radius:8px;',
      axisPointer: { type: 'line', lineStyle: { color: border, width: 1 } },
    },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { color: text, fontSize: 11, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: text, fontSize: 11 }, splitLine: { lineStyle: { color: grid } } },
    legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4, itemGap: 14, textStyle: { color: text, fontSize: 11 } },
  };
}

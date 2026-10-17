import { memo, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { AnimatedNumber, Sparkline } from '@/components/primitives';
import { item } from '@/lib/motion';

export const MetricTile = memo(function MetricTile({ label, value, format, unit, sparkline, tone = 'default', hint, children }: {
  label: string; value: number | null | undefined; format: (n: number) => string; unit?: string; sparkline?: (number | null)[];
  tone?: 'default' | 'ok' | 'warn' | 'crit'; hint?: ReactNode; children?: ReactNode;
}) {
  return (
    <motion.div variants={item} className="card relative min-w-0 overflow-hidden p-3.5">
      <p className="eyebrow">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1">
        {value === null || value === undefined ? <span className="text-2xl font-semibold text-subtle">—</span> : (
          <AnimatedNumber value={value} format={format} className={cn('text-2xl font-semibold tracking-tight', tone === 'warn' && 'text-warn', tone === 'crit' && 'text-crit', tone === 'ok' && 'text-ok')} />
        )}
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
      {sparkline && <Sparkline points={sparkline} className="mt-2" color={tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn)' : 'var(--primary)'} />}
      {children}
    </motion.div>
  );
});

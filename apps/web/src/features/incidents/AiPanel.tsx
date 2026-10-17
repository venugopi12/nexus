import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { post, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/primitives';

interface Analysis {
  provider: 'rule-based' | 'anthropic';
  providerNote?: string;
  summary: string;
  disclaimer: string;
  findings: { id: string; confidence: 'observed' | 'correlated' | 'possible'; statement: string; evidence: { kind: string; label: string; href?: string }[] }[];
}

const TONE = { observed: 'bg-ok-soft text-ok', correlated: 'bg-warn-soft text-warn', possible: 'bg-muted text-muted-foreground' } as const;

export function AiPanel({ incidentId }: { incidentId: string }) {
  const m = useMutation({ mutationFn: () => post<Analysis>(`/incidents/${incidentId}/analysis`) });
  return (
    <Panel title={<span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-primary" /> Incident assistant</span>} subtitle="Evidence-linked summary. Hypotheses are labelled; nothing is presented as a confirmed cause."
      actions={<Button size="sm" variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? 'Analyzing…' : m.data ? 'Re-run' : 'Analyze'}</Button>}>
      {m.isError && <p role="alert" className="text-sm text-crit">{errorMessage(m.error)}</p>}
      {!m.data && !m.isError && <p className="text-sm text-muted-foreground">Summarises related metrics, events, traces and deployments for this incident. Uses a deterministic rule-based engine unless an AI provider is configured on the server.</p>}
      {m.data && (
        <div className="space-y-3">
          <p className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed">{m.data.summary}</p>
          <p className="text-[11px] uppercase tracking-wide text-subtle">Engine: {m.data.provider === 'anthropic' ? 'AI provider' : 'rule-based (deterministic)'}</p>
          {m.data.providerNote && <p className="text-xs text-warn">{m.data.providerNote}</p>}
          <ul className="space-y-2.5">
            {m.data.findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex items-center gap-2"><span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', TONE[f.confidence])}>{f.confidence}</span></div>
                <p className="text-sm">{f.statement}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {f.evidence.map((e, i) => e.href ? <Link key={i} to={e.href} className="rounded border border-border px-1.5 py-0.5 text-xs text-primary hover:bg-accent">{e.kind}: {e.label}</Link> : <span key={i} className="rounded border border-border px-1.5 py-0.5 text-xs">{e.label}</span>)}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle">{m.data.disclaimer}</p>
        </div>
      )}
    </Panel>
  );
}

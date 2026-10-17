import type { SpanDto } from '@nexus/shared';

export interface SpanRow extends SpanDto { depth: number; hasChildren: boolean; selfMs: number; endOffsetMs: number }

/**
 * Orders spans depth-first (parent before children, children by start time) and computes
 * self-time = duration − union(children intervals). Orphans are attached at root so nothing is dropped.
 */
export function buildSpanRows(spans: SpanDto[], collapsed: Set<string> = new Set()): { rows: SpanRow[]; all: SpanRow[]; totalMs: number; violations: string[] } {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const children = new Map<string | null, SpanDto[]>();
  for (const s of spans) {
    const key = s.parentId && byId.has(s.parentId) ? s.parentId : null;
    children.set(key, [...(children.get(key) ?? []), s]);
  }
  for (const list of children.values()) list.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  const violations: string[] = [];
  const all: SpanRow[] = [];
  const rows: SpanRow[] = [];
  const walk = (parent: string | null, depth: number, hidden: boolean) => {
    for (const s of children.get(parent) ?? []) {
      const kids = children.get(s.spanId) ?? [];
      // self time: duration minus merged child intervals
      let covered = 0;
      let curStart = -1;
      let curEnd = -1;
      for (const k of kids) {
        if (curEnd < 0 || k.startOffsetMs > curEnd) { if (curEnd >= 0) covered += curEnd - curStart; curStart = k.startOffsetMs; curEnd = k.startOffsetMs + k.durationMs; }
        else curEnd = Math.max(curEnd, k.startOffsetMs + k.durationMs);
        if (k.startOffsetMs + 0.0011 < s.startOffsetMs || k.startOffsetMs + k.durationMs > s.startOffsetMs + s.durationMs + 0.0011) violations.push(`${k.spanId} exceeds parent ${s.spanId}`);
      }
      if (curEnd >= 0) covered += curEnd - curStart;
      const row: SpanRow = { ...s, depth, hasChildren: kids.length > 0, selfMs: Math.max(0, s.durationMs - covered), endOffsetMs: s.startOffsetMs + s.durationMs };
      all.push(row);
      if (!hidden) rows.push(row);
      walk(s.spanId, depth + 1, hidden || collapsed.has(s.spanId));
    }
  };
  walk(null, 0, false);
  const totalMs = all.reduce((m, r) => Math.max(m, r.endOffsetMs), 0);
  return { rows, all, totalMs, violations };
}

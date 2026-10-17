export interface LayoutEdge { source: string; target: string }

/**
 * Layered (Sugiyama-lite) layout for a call graph: layer = longest path from any root,
 * order within layer by barycenter of already-placed neighbours to reduce edge crossings.
 */
export function layeredLayout(nodeIds: string[], edges: LayoutEdge[], opts: { xGap?: number; yGap?: number } = {}) {
  const { xGap = 300, yGap = 118 } = opts;
  const out = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  nodeIds.forEach((n) => { out.set(n, []); incoming.set(n, []); });
  edges.forEach((e) => { out.get(e.source)?.push(e.target); incoming.get(e.target)?.push(e.source); });

  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (n: string): number => {
    if (layer.has(n)) return layer.get(n)!;
    if (visiting.has(n)) return 0; // cycle guard
    visiting.add(n);
    const ins = incoming.get(n) ?? [];
    const d = ins.length ? Math.max(...ins.map(depth)) + 1 : 0;
    visiting.delete(n);
    layer.set(n, d);
    return d;
  };
  nodeIds.forEach(depth);

  const layers: string[][] = [];
  nodeIds.forEach((n) => { (layers[layer.get(n)!] ??= []).push(n); });
  const pos = new Map<string, { x: number; y: number }>();
  const order = new Map<string, number>();
  layers.forEach((ids, li) => {
    if (!ids) return;
    const bary = (n: string) => {
      const ps = (incoming.get(n) ?? []).map((p) => order.get(p)).filter((v): v is number => v !== undefined);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
    };
    ids.sort((a, b) => bary(a) - bary(b) || a.localeCompare(b));
    ids.forEach((n, i) => { order.set(n, i); });
    const height = (ids.length - 1) * yGap;
    ids.forEach((n, i) => pos.set(n, { x: li * xGap, y: i * yGap - height / 2 }));
  });
  return pos;
}

/** Transitive closure along edges in one direction. */
export function reach(start: string, edges: LayoutEdge[], dir: 'down' | 'up'): Set<string> {
  const adj = new Map<string, string[]>();
  edges.forEach((e) => {
    const [a, b] = dir === 'down' ? [e.source, e.target] : [e.target, e.source];
    adj.set(a, [...(adj.get(a) ?? []), b]);
  });
  const seen = new Set<string>();
  const stack = [...(adj.get(start) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n) || n === start) continue;
    seen.add(n);
    stack.push(...(adj.get(n) ?? []));
  }
  return seen;
}

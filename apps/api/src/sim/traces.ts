import { SimModel, unit, type ServiceProfile } from '@nexus/shared';

export interface BuiltSpan {
  spanId: string;
  parentId: string | null;
  serviceKey: string;
  operation: string;
  startOffsetMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number>;
}
export interface BuiltTrace {
  traceId: string;
  rootService: string;
  rootOperation: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  errorCount: number;
  services: string[];
  spans: BuiltSpan[];
}

const ROOT_OPS = ['GET /v1/products', 'POST /v1/checkout', 'GET /v1/search', 'POST /v1/login', 'GET /v1/me', 'POST /v1/orders', 'GET /v1/reports'];
const OPS: Record<string, string[]> = {
  edge: ['route', 'tls.handshake'],
  service: ['handle', 'rpc.call', 'validate'],
  database: ['SELECT', 'INSERT', 'UPDATE'],
  cache: ['GET', 'SET'],
  queue: ['publish', 'consume'],
};
const MAX_SPANS = 140;

const hex = (n: number, ...parts: (string | number)[]) =>
  Array.from({ length: Math.ceil(n / 8) }, (_, i) =>
    Math.floor(unit(...parts, 'h', i) * 0xffffffff).toString(16).padStart(8, '0'),
  ).join('').slice(0, n);

/**
 * Builds a causally-consistent span tree: children start after their parent, run sequentially,
 * and a parent's duration always covers its last child plus its own self time.
 */
export function buildTrace(model: SimModel, orgSlug: string, env: string, startMs: number, index: number): BuiltTrace {
  const profiles = new Map(model.ctx.services.map((s) => [s.key, s]));
  const edges = model.ctx.services.filter((s) => s.kind === 'edge');
  const root = edges[Math.floor(unit(orgSlug, env, 'root', index) * edges.length)] ?? model.ctx.services[0]!;
  const traceId = hex(32, orgSlug, env, 'trace', index);
  const spans: BuiltSpan[] = [];
  let counter = 0;
  const u = (k: string, ...extra: (string | number)[]) => unit(orgSlug, env, index, k, ...extra);

  const visit = (svc: ServiceProfile, offset: number, parent: string | null, depth: number): { dur: number; err: boolean } => {
    const spanId = hex(16, traceId, counter++);
    const slot = spans.length;
    spans.push(undefined as unknown as BuiltSpan);
    const t = startMs + offset;
    const imp = model.impact(svc.key, t);
    const sample = model.sample(svc.key, 'latency_ms', t);
    const errPct = model.sample(svc.key, 'error_rate', t);
    const own = svc.kind === 'database' || svc.kind === 'cache' || svc.kind === 'queue';
    const selfTime = own ? sample * (0.8 + 0.4 * u('self', spanId)) : sample * 0.28 * (0.6 + 0.8 * u('self', spanId));
    let cursor = offset + (own ? 0 : selfTime * 0.35);
    let childErr = false;
    if (depth < 6 && !own) {
      for (const depKey of svc.dependsOn) {
        const dep = profiles.get(depKey);
        if (!dep || spans.length >= MAX_SPANS) continue;
        if (u('take', spanId, depKey) > 0.82 && dep.kind === 'service') continue;
        const repeat = dep.kind === 'service' || dep.kind === 'queue' ? 1 : 1 + Math.floor(u('rep', spanId, depKey) * (imp.latency > 0.3 ? 8 : 5));
        for (let r = 0; r < repeat && spans.length < MAX_SPANS; r++) {
          const c = visit(dep, cursor + 0.2, spanId, depth + 1);
          cursor += c.dur + 0.2;
          childErr = childErr || c.err;
        }
      }
    }
    const dur = cursor - offset + (own ? 0 : selfTime * 0.65);
    const selfErr = u('err', spanId) * 100 < Math.min(95, errPct * (own ? 1 : 1.2));
    const err = selfErr || (childErr && u('prop', spanId) < 0.7);
    const ops = OPS[svc.kind]!;
    spans[slot] = {
      spanId,
      parentId: parent,
      serviceKey: svc.key,
      operation: depth === 0 ? ROOT_OPS[Math.floor(u('rootop') * ROOT_OPS.length)]! : `${svc.key}.${ops[Math.floor(u('op', spanId) * ops.length)]}`,
      startOffsetMs: round(offset),
      durationMs: round(Math.max(dur, 0.05)),
      status: err ? 'error' : 'ok',
      attributes: {
        'http.status_code': err ? (u('code', spanId) < 0.5 ? 500 : 503) : 200,
        'host.region': ['us-east-1', 'us-west-2', 'eu-west-1'][Math.floor(u('reg') * 3)]!,
        'simulated': 1,
      },
    };
    return { dur, err };
  };

  const r = visit(root, 0, null, 0);
  const services = [...new Set(spans.map((s) => s.serviceKey))];
  return {
    traceId,
    rootService: root.key,
    rootOperation: spans[0]!.operation,
    startMs,
    durationMs: round(r.dur),
    status: r.err ? 'error' : 'ok',
    errorCount: spans.filter((s) => s.status === 'error').length,
    services,
    spans,
  };
}
const round = (n: number) => Math.round(n * 1000) / 1000;

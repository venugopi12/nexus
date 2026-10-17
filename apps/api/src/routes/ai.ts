import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { resolveFlag } from '@nexus/shared';
import * as s from '../db/schema';
import { need, parse } from '../plugins';
import { forbidden } from '../lib/errors';
import { getIncident } from '../domain/incidents';
import { analyzeIncident } from '../ai/assistant';
import { audit } from '../lib/audit';

export async function aiRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  app.post('/incidents/:id/analysis', async (req) => {
    const a = need(req, 'ai:use');
    need(req, 'incident:read');
    const id = parse(z.string().uuid(), (req.params as { id: string }).id);
    const [flag] = await ctx.db.select().from(s.featureFlags).where(eq(s.featureFlags.key, 'ai-assistant'));
    const overrides = await ctx.db.select().from(s.flagOverrides).where(eq(s.flagOverrides.flagKey, 'ai-assistant'));
    const org = overrides.find((o) => o.orgId === a.orgId && !o.environment);
    const on = !!flag && resolveFlag('ai-assistant', a.userId, { base: { enabled: flag.enabled, rolloutPercent: flag.rolloutPercent }, orgOverride: org && { enabled: org.enabled, rolloutPercent: org.rolloutPercent } });
    if (!on) throw forbidden('The AI assistant is disabled for this organization');
    const incident = await getIncident(ctx, a.orgId, id);
    const analysis = await analyzeIncident(ctx, a.orgId, incident);
    await audit(ctx.db, { orgId: a.orgId, actorId: a.userId, action: 'ai.analysis_generated', resource: 'incident', resourceId: id, metadata: { provider: analysis.provider } });
    return analysis;
  });
}

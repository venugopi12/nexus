import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { sql } from 'drizzle-orm';
import { createDb } from './db/client';
import { loadEnv, type Env } from './env';
import { SimRegistry } from './sim/registry';
import { SimEngine } from './sim/engine';
import { startEvaluator } from './domain/alerts';
import { createSocketServer } from './realtime/socket';
import { registerAuth } from './plugins';
import type { AppContext, Bus } from './context';
import { authRoutes } from './routes/auth';
import { incidentRoutes } from './routes/incidents';
import { metricRoutes } from './routes/metrics';
import { serviceRoutes } from './routes/services';
import { eventRoutes } from './routes/events';
import { traceRoutes } from './routes/traces';
import { deploymentRoutes } from './routes/deployments';
import { alertRoutes } from './routes/alerts';
import { miscRoutes } from './routes/misc';
import { aiRoutes } from './routes/ai';

export async function buildApp(overrides: Partial<Env> = {}, opts: { withSockets?: boolean } = {}) {
  const env = loadEnv({ ...process.env, ...(overrides as Record<string, string>) });
  const app = Fastify({
    logger: env.LOG_LEVEL === 'silent' ? false : { level: env.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization'], ...(env.NODE_ENV === 'development' ? { transport: undefined } : {}) },
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });
  const { db, client } = createDb(env.DATABASE_URL);
  const registry = new SimRegistry(db);
  let bus: Bus = { emit: () => {} };
  const ctx: AppContext = { db, env, registry, log: app.log, get bus() { return bus; } } as AppContext;
  app.decorate('ctx', ctx);

  await app.register(cors, { origin: env.WEB_ORIGIN.split(','), credentials: true });
  await app.register(cookie);
  registerAuth(app);

  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready', db: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable', db: 'down' });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(incidentRoutes);
      await api.register(metricRoutes);
      await api.register(serviceRoutes);
      await api.register(eventRoutes);
      await api.register(traceRoutes);
      await api.register(deploymentRoutes);
      await api.register(alertRoutes);
      await api.register(miscRoutes);
      await api.register(aiRoutes);
    },
    { prefix: '/api/v1' },
  );

  let socket: ReturnType<typeof createSocketServer> | undefined;
  if (opts.withSockets !== false) {
    socket = createSocketServer(app, env.WEB_ORIGIN.split(',')[0]!);
    bus = socket.bus;
  }
  const engine = new SimEngine(ctx);
  let stopEval: (() => void) | undefined;

  app.addHook('onClose', async () => {
    engine.stop();
    stopEval?.();
    await socket?.close();
    await client.end({ timeout: 2 });
  });

  return {
    app, ctx, engine,
    setBus: (b: Bus) => { bus = b; },
    async startBackground() {
      if (env.SIM_ENABLED === 'true') {
        await engine.start();
        stopEval = startEvaluator(ctx);
      }
    },
  };
}

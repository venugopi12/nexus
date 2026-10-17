import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { ZodError, type ZodType } from 'zod';
import { can, type Permission } from '@nexus/shared';
import { memberships, sessions, users } from './db/schema';
import { HttpError, forbidden, unauthorized } from './lib/errors';
import { sha256 } from './lib/password';
import type { AuthCtx } from './context';

export const SESSION_COOKIE = 'nexus_session';

export async function resolveSession(app: FastifyInstance, token: string | undefined): Promise<AuthCtx | null> {
  if (!token) return null;
  const hash = sha256(token);
  const { db } = app.ctx;
  const [row] = await db
    .select({ userId: sessions.userId, orgId: sessions.orgId, email: users.email, name: users.name, role: memberships.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.orgId, sessions.orgId)))
    .where(and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, new Date())));
  return row ? { ...row, sessionHash: hash } : null;
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('auth', undefined);

  app.addHook('onRequest', async (req) => {
    const token = (req as FastifyRequest & { cookies: Record<string, string | undefined> }).cookies?.[SESSION_COOKIE];
    const auth = await resolveSession(app, token);
    if (auth) req.auth = auth;
  });

  // CSRF defence in depth: SameSite=Lax cookies + a custom header that cross-site forms cannot set.
  app.addHook('preHandler', async (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.headers['x-nexus-client']) {
      throw new HttpError(403, 'csrf', 'Missing x-nexus-client header');
    }
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'validation_error', message: 'Invalid request', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: 'request_error', message: e.message ?? 'Bad request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Internal server error' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } }));
}

export function authed(req: FastifyRequest): AuthCtx {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Server-side permission gate. Returns the auth context for convenient destructuring. */
export function need(req: FastifyRequest, permission: Permission): AuthCtx {
  const a = authed(req);
  if (!can(a.role, permission)) throw forbidden(`Missing permission: ${permission}`);
  return a;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export type Reply = FastifyReply;

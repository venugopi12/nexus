import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ROLE_PERMISSIONS, loginSchema, type SessionUser } from '@nexus/shared';
import * as s from '../db/schema';
import { SESSION_COOKIE, authed, parse } from '../plugins';
import { HttpError, forbidden } from '../lib/errors';
import { newSessionToken, sha256, verifyPassword } from '../lib/password';
import { audit } from '../lib/audit';

// naive in-memory limiter: 8 failed attempts / 5 min per (ip,email)
const failures = new Map<string, { n: number; first: number }>();
const WINDOW = 5 * 60_000;
const MAX = 8;
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zx3m1l5vK8d1bO0rYk1W7n2Gx0p0kQ0n0f2f0Q4m2cs';

export async function sessionUser(app: FastifyInstance, userId: string, orgId: string): Promise<SessionUser> {
  const { db } = app.ctx;
  const orgs = await db
    .select({ id: s.organizations.id, slug: s.organizations.slug, name: s.organizations.name, role: s.memberships.role })
    .from(s.memberships).innerJoin(s.organizations, eq(s.organizations.id, s.memberships.orgId)).where(eq(s.memberships.userId, userId));
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  const current = orgs.find((o) => o.id === orgId)!;
  return { id: u!.id, email: u!.email, name: u!.name, orgId, role: current.role, permissions: [...ROLE_PERMISSIONS[current.role]], orgs };
}

export async function authRoutes(app: FastifyInstance) {
  const { db, env } = app.ctx;
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: env.COOKIE_SECURE === 'true', maxAge: env.SESSION_TTL_HOURS * 3600 };

  app.post('/auth/login', async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const key = `${req.ip}:${email.toLowerCase()}`;
    const f = failures.get(key);
    if (f && Date.now() - f.first < WINDOW && f.n >= MAX) throw new HttpError(429, 'rate_limited', 'Too many failed attempts. Try again in a few minutes.');
    const [user] = await db.select().from(s.users).where(eq(s.users.email, email.toLowerCase()));
    const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password); // constant-ish time for unknown users
    if (!user || !ok) {
      const cur = f && Date.now() - f.first < WINDOW ? f : { n: 0, first: Date.now() };
      failures.set(key, { n: cur.n + 1, first: cur.first });
      throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
    }
    failures.delete(key);
    const memberships = await db.select().from(s.memberships).where(eq(s.memberships.userId, user.id));
    const first = memberships[0];
    if (!first) throw forbidden('Account has no organization membership');
    const token = newSessionToken();
    await db.insert(s.sessions).values({ tokenHash: sha256(token), userId: user.id, orgId: first.orgId, expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000) });
    await audit(db, { orgId: first.orgId, actorId: user.id, action: 'auth.login', resource: 'session', metadata: { ip: req.ip } });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { user: await sessionUser(app, user.id, first.orgId) };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.auth) {
      await db.delete(s.sessions).where(eq(s.sessions.tokenHash, req.auth.sessionHash));
      await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: 'auth.logout', resource: 'session' });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const a = authed(req);
    return { user: await sessionUser(app, a.userId, a.orgId) };
  });

  app.post('/auth/switch-org', async (req) => {
    const a = authed(req);
    const { orgId } = parse(z.object({ orgId: z.string().uuid() }), req.body);
    const [m] = await db.select().from(s.memberships).where(and(eq(s.memberships.userId, a.userId), eq(s.memberships.orgId, orgId)));
    if (!m) throw forbidden('You are not a member of that organization');
    await db.update(s.sessions).set({ orgId }).where(eq(s.sessions.tokenHash, a.sessionHash));
    await audit(db, { orgId, actorId: a.userId, action: 'auth.switch_org', resource: 'session', metadata: { from: a.orgId } });
    return { user: await sessionUser(app, a.userId, orgId) };
  });
}

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { TEST_URL } from './global-setup';

export async function makeApp() {
  const built = await buildApp({ DATABASE_URL: TEST_URL, SIM_ENABLED: 'false', LOG_LEVEL: 'silent', SEED_PASSWORD: 'nexus-demo-2026' } as never);
  await built.app.ready();
  return built;
}

export async function login(app: FastifyInstance, email: string, password = 'nexus-demo-2026') {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-nexus-client': 'web' }, payload: { email, password } });
  const cookie = (res.headers['set-cookie'] as string | undefined)?.split(';')[0] ?? '';
  return { res, cookie, user: res.json().user };
}

export const api = (app: FastifyInstance, cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie, 'x-nexus-client': 'web' } }),
  post: (url: string, payload?: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, 'x-nexus-client': 'web' }, payload: payload as never }),
  patch: (url: string, payload?: unknown) => app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie, 'x-nexus-client': 'web' }, payload: payload as never }),
  put: (url: string, payload?: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, 'x-nexus-client': 'web' }, payload: payload as never }),
  del: (url: string) => app.inject({ method: 'DELETE', url: `/api/v1${url}`, headers: { cookie, 'x-nexus-client': 'web' } }),
});

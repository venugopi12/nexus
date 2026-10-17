import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db/client';
import type { Env } from './env';
import type { SimRegistry } from './sim/registry';

/** Room-scoped publish abstraction so domain code never touches Socket.IO directly. */
export interface Bus {
  emit(room: string, event: string, payload: unknown): void;
}
export const orgRoom = (orgId: string) => `org:${orgId}`;
export const envRoom = (orgId: string, env: string) => `org:${orgId}:env:${env}`;
export const userRoom = (userId: string) => `user:${userId}`;

export interface AppContext {
  db: Db;
  env: Env;
  registry: SimRegistry;
  bus: Bus;
  log: FastifyBaseLogger;
}

export interface AuthCtx {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  role: 'admin' | 'sre' | 'engineer' | 'viewer';
  sessionHash: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthCtx;
  }
  interface FastifyInstance {
    ctx: AppContext;
  }
}

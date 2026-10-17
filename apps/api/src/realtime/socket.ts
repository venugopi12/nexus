import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import type { ClientToServerEvents, ServerToClientEvents } from '@nexus/shared';
import { ENVIRONMENTS } from '@nexus/shared';
import { SESSION_COOKIE, resolveSession } from '../plugins';
import { envRoom, orgRoom, userRoom, type AuthCtx, type Bus } from '../context';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSocketServer(app: FastifyInstance, webOrigin: string) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { auth: AuthCtx; env: string }>(app.server, {
    cors: { origin: webOrigin, credentials: true },
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  io.use(async (socket, next) => {
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
    const auth = await resolveSession(app, token);
    if (!auth) return next(new Error('unauthorized'));
    socket.data.auth = auth;
    socket.data.env = 'production';
    next();
  });

  io.on('connection', (socket) => {
    const join = async (env: string) => {
      // re-resolve so an org switch on the session is honoured and revoked sessions are dropped
      const fresh = await resolveSession(app, parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]);
      if (!fresh) return socket.disconnect(true);
      for (const r of socket.rooms) if (r !== socket.id) await socket.leave(r);
      socket.data.auth = fresh;
      socket.data.env = env;
      await socket.join([orgRoom(fresh.orgId), envRoom(fresh.orgId, env), userRoom(fresh.userId)]);
    };
    void join('production');
    socket.on('subscribe', async ({ env }, ack) => {
      if (!(ENVIRONMENTS as readonly string[]).includes(env)) return ack?.({ ok: false });
      await join(env);
      ack?.({ ok: true });
    });
  });

  const hb = setInterval(() => io.emit('heartbeat', Date.now()), 5000);
  hb.unref();

  const bus: Bus = { emit: (room, event, payload) => void (io.to(room) as unknown as { emit: (e: string, p: unknown) => void }).emit(event, payload) };
  return { io, bus, close: () => { clearInterval(hb); return io.close(); } };
}

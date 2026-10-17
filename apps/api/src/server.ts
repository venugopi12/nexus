import { buildApp } from './app';
import { env } from './env';
import { runMigrations } from './db/migrate';

const { app, startBackground } = await buildApp();
await runMigrations(env.DATABASE_URL);
await app.listen({ port: env.PORT, host: env.HOST });
await startBackground();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

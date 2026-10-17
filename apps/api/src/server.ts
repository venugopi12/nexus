import { sql } from 'drizzle-orm';
import { buildApp } from './app';
import { env } from './env';
import { runMigrations } from './db/migrate';

const { app, ctx, startBackground } = await buildApp();
await runMigrations(env.DATABASE_URL);
await app.listen({ port: env.PORT, host: env.HOST });

// Hosted demos (e.g. Render) have no shell to run the seed once: seed a fresh, empty database on first boot.
if (process.env.SEED_IF_EMPTY === 'true') {
  const rows = await ctx.db.execute(sql`select count(*)::int as n from organizations`);
  const n = Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  if (n === 0) {
    app.log.info('database is empty: seeding demo data');
    const { seed } = await import('./seed/index');
    await seed(env.DATABASE_URL, { eventDays: Number(process.env.SEED_EVENT_DAYS ?? 14) });
    app.log.info('seed complete');
  }
}

await startBackground();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

/**
 * Runs a real PostgreSQL server (via the `embedded-postgres` binaries) for local development when
 * Docker is not available. Production-style setups use docker-compose.yml instead.
 */
import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../env';

export async function startEmbedded(opts: { dir: string; port: number; persistent?: boolean }) {
  const fresh = !fs.existsSync(path.join(opts.dir, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: opts.dir,
    user: 'nexus',
    password: 'nexus',
    port: opts.port,
    persistent: opts.persistent ?? true,
    onLog: () => {},
    onError: (m) => console.error('[pg]', String(m).trim()),
  });
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase('nexus');
  return pg;
}

if (process.argv[1]?.endsWith('embedded.ts')) {
  const port = Number(new URL(env.DATABASE_URL).port || 5432);
  const dir = path.resolve(process.cwd(), env.EMBEDDED_PG_DIR);
  startEmbedded({ dir, port }).then((pg) => {
    console.log(`embedded postgres listening on :${port} (data: ${dir})`);
    const stop = async () => {
      await pg.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createDb } from './client';
import { env } from '../env';

export async function runMigrations(url = env.DATABASE_URL) {
  const { db, client } = createDb(url, 1);
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db/*.ts (dev) → ../../drizzle ; dist/*.js (bundled) → ../drizzle
  const dir = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')].find((d) => fs.existsSync(d)) ?? path.resolve(here, '../../drizzle');
  await migrate(db, { migrationsFolder: dir });
  await client.end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => console.log('migrations applied'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

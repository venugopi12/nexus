import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(url: string, max = 10) {
  const client = postgres(url, { max, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}
export { schema };

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startEmbedded } from '../src/db/embedded';
import { seed } from '../src/seed';

export const TEST_PORT = 54330;
export const TEST_URL = `postgres://nexus:nexus@127.0.0.1:${TEST_PORT}/nexus`;

export default async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pg-test-'));
  const pg = await startEmbedded({ dir, port: TEST_PORT, persistent: false });
  await seed(TEST_URL, { quiet: true, eventDays: 1 });
  return async () => {
    await pg.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

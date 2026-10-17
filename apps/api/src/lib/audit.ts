import { auditLogs } from '../db/schema';
import type { Db } from '../db/client';

type Executor = Pick<Db, 'insert'>;

export async function audit(
  db: Executor,
  entry: { orgId: string; actorId: string | null; action: string; resource: string; resourceId?: string | null; metadata?: Record<string, unknown> },
) {
  await db.insert(auditLogs).values({
    orgId: entry.orgId,
    actorId: entry.actorId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    metadata: entry.metadata ?? {},
  });
}

import { and, eq, inArray } from 'drizzle-orm';
import { can, type Permission, type Role } from '@nexus/shared';
import { memberships, notifications } from '../db/schema';
import { userRoom, type AppContext } from '../context';

/** Notify specific users, or every member holding `permission`. */
export async function notify(
  ctx: AppContext,
  orgId: string,
  target: { userIds: string[] } | { permission: Permission },
  n: { kind: 'alert' | 'incident' | 'mention' | 'system'; title: string; body?: string; href?: string },
) {
  let userIds: string[];
  if ('userIds' in target) userIds = target.userIds;
  else {
    const rows = await ctx.db.select().from(memberships).where(eq(memberships.orgId, orgId));
    userIds = rows.filter((m) => can(m.role as Role, target.permission)).map((m) => m.userId);
  }
  if (!userIds.length) return;
  const valid = await ctx.db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, userIds)));
  const rows = await ctx.db
    .insert(notifications)
    .values(valid.map((v) => ({ orgId, userId: v.userId, kind: n.kind, title: n.title, body: n.body ?? '', href: n.href ?? null })))
    .returning();
  for (const r of rows) {
    ctx.bus.emit(userRoom(r.userId), 'notification:new', {
      id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, createdAt: r.createdAt.toISOString(), read: false,
    });
  }
}

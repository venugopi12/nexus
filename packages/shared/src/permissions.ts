export const ROLES = ['admin', 'sre', 'engineer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'incident:read',
  'incident:create',
  'incident:update',
  'incident:comment',
  'incident:resolve',
  'service:read',
  'service:write',
  'alert:read',
  'alert:write',
  'alert:ack',
  'deployment:read',
  'deployment:write',
  'flag:read',
  'flag:write',
  'team:read',
  'team:write',
  'audit:read',
  'settings:read',
  'settings:write',
  'ai:use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const viewer: Permission[] = [
  'incident:read',
  'service:read',
  'alert:read',
  'deployment:read',
  'team:read',
  'settings:read',
  'flag:read',
];
const engineer: Permission[] = [
  ...viewer,
  'incident:create',
  'incident:update',
  'incident:comment',
  'alert:ack',
  'ai:use',
];
const sre: Permission[] = [
  ...engineer,
  'incident:resolve',
  'service:write',
  'alert:write',
  'deployment:write',
  'audit:read',
];
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer,
  engineer,
  sre,
  admin: [...PERMISSIONS],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

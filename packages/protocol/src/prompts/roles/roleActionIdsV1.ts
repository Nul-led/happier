export const ROLE_ACTION_IDS_V1 = [
  'session.role.set',
  'session.roles.override.set', 'session.roles.override.clear',
  'session.roles.add', 'session.roles.remove',
  'session.notes.set', 'session.roles.apply_to_reports',
  'roles.list', 'roles.get', 'roles.create', 'roles.update', 'roles.delete',
  'roles.override.set', 'roles.override.reset',
] as const;

export type RoleActionIdV1 = typeof ROLE_ACTION_IDS_V1[number];

export function isRoleActionIdV1(value: string): value is RoleActionIdV1 {
  return (ROLE_ACTION_IDS_V1 as readonly string[]).includes(value);
}

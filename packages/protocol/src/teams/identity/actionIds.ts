/**
 * Team identity Action ids are dependency-free because the shared Action id
 * registry initializes before Team identity's domain schema graph.
 */
export const TEAM_IDENTITY_ACTION_IDS_V1 = [
  'teams.identity.connections.list',
  'teams.identity.connections.create',
  'teams.identity.connections.settings.update',
  'teams.identity.connections.enable',
  'teams.identity.connections.disable',
  'teams.identity.connections.remove.preview',
  'teams.identity.connections.remove',
  'teams.identity.connections.test.start',
  'teams.identity.connections.test.consume',
  'teams.identity.workos.adminPortalLink.create',
  'teams.identity.workos.connection.create',
  'teams.identity.workos.reconcile',
  'teams.identity.workos.connection.set',
] as const;

export type TeamIdentityActionIdV1 = typeof TEAM_IDENTITY_ACTION_IDS_V1[number];

export const TEAM_IDENTITY_CONNECTION_USER_ACTION_IDS_V1 = [
  'teams.identity.connections.settings.update',
  'teams.identity.connections.enable',
  'teams.identity.connections.disable',
  'teams.identity.connections.remove',
  'teams.identity.connections.test.start',
  'teams.identity.workos.adminPortalLink.create',
  'teams.identity.workos.reconcile',
  'teams.identity.workos.connection.set',
] as const satisfies readonly TeamIdentityActionIdV1[];

export type TeamIdentityConnectionUserActionIdV1 =
  typeof TEAM_IDENTITY_CONNECTION_USER_ACTION_IDS_V1[number];

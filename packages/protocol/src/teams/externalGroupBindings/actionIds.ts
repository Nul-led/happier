/** Dependency-free ids for the shared external Group mapping family. */
export const TEAM_EXTERNAL_GROUP_BINDING_ACTION_IDS_V1 = [
  'teams.externalGroupBindings.list',
  'teams.externalGroupBindings.set',
  'teams.externalGroupBindings.remove',
] as const;

export type TeamExternalGroupBindingActionIdV1 = typeof TEAM_EXTERNAL_GROUP_BINDING_ACTION_IDS_V1[number];

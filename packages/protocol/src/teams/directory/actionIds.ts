/**
 * The Team directory family's ids.
 *
 * They live apart from `./v1.js` because the shared Action id registry consumes
 * them during its own initialization, before any domain schema module has
 * finished evaluating. Reaching them through a module that imports Team
 * membership — and therefore, transitively, the feature and browser capability
 * graph that imports the id registry back — leaves `ACTION_ID_FAMILIES_V1`
 * half-built and takes the whole Action catalog down with it.
 *
 * The rule this file exists to keep: an Action id module imports nothing but
 * other id modules.
 */
export const TEAM_DIRECTORY_ACTION_IDS_V1 = [
  'teams.directory.sourceSetup.list',
  'teams.directory.sources.list',
  'teams.directory.sources.get',
  'teams.directory.people.list',
  'teams.directory.groups.list',
  'teams.directory.sources.create',
  'teams.directory.sources.sync',
  'teams.directory.sources.pause',
  'teams.directory.sources.resume',
  'teams.directory.sources.remove.preview',
  'teams.directory.sources.remove',
] as const;

export type TeamDirectoryActionIdV1 = typeof TEAM_DIRECTORY_ACTION_IDS_V1[number];

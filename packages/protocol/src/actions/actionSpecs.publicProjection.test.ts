import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  getActionSpec,
  PLUGIN_ACTION_INPUT_SCHEMAS,
  PLUGIN_ACTION_OUTPUT_SCHEMAS,
  PUBLIC_ACTION_INPUT_SCHEMAS,
  PUBLIC_ACTION_OUTPUT_SCHEMAS,
  PublicActionIdSchema,
  SignedRootActionIdSchema,
  type PluginActionInputById,
  type PluginActionResultById,
  type PublicActionId,
  type PublicActionInputById,
  type PublicActionResultById,
} from './actionSpecs.js';

describe('Action public projection', () => {
  it('keeps Artifact and Team automation rows in the public type and runtime projections', () => {
    const publicIds = [
      'artifact.access.grants.list',
      'artifact.access.grants.set',
      'artifact.access.grants.remove',
      'teams.directory.groups.list',
      'teams.directory.people.list',
      'teams.directory.sourceSetup.list',
      'teams.directory.sources.get',
      'teams.directory.sources.list',
      'teams.directory.sources.remove',
      'teams.directory.sources.remove.preview',
      'teams.externalGroupBindings.list',
      'teams.externalGroupBindings.remove',
      'teams.externalGroupBindings.set',
      'teams.identity.connections.list',
      'teams.identity.connections.remove.preview',
      'teams.identity.connections.test.consume',
      'teams.identity.connections.test.start',
      'teams.identity.workos.adminPortalLink.create',
    ] as const satisfies readonly PublicActionId[];
    type PublicFamilyId = typeof publicIds[number];
    expectTypeOf<Pick<PublicActionInputById, PublicFamilyId>>()
      .toEqualTypeOf<Pick<PluginActionInputById, PublicFamilyId>>();
    expectTypeOf<Pick<PublicActionResultById, PublicFamilyId>>()
      .toEqualTypeOf<Pick<PluginActionResultById, PublicFamilyId>>();
    for (const id of publicIds) {
      expect(getActionSpec(id).requiredAuthority).toBe('account_automation');
      expect(PublicActionIdSchema.safeParse(id).success).toBe(true);
      expect(PUBLIC_ACTION_INPUT_SCHEMAS[id]).toBe(PLUGIN_ACTION_INPUT_SCHEMAS[id]);
      expect(PUBLIC_ACTION_OUTPUT_SCHEMAS[id]).toBe(PLUGIN_ACTION_OUTPUT_SCHEMAS[id]);
    }

    const presentUserIds = [
      'teams.directory.sources.create',
      'teams.directory.sources.sync',
      'teams.identity.connections.create',
      'teams.identity.connections.remove',
    ] as const;
    expectTypeOf<Extract<PublicActionId, typeof presentUserIds[number]>>().toEqualTypeOf<never>();
    for (const id of presentUserIds) {
      expect(getActionSpec(id).requiredAuthority).toBe('present_user');
      expect(PublicActionIdSchema.safeParse(id).success).toBe(false);
      expect(SignedRootActionIdSchema.safeParse(id).success).toBe(true);
    }
  });
});

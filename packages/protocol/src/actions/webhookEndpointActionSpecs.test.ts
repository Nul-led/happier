import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import {
  getActionSpec,
  isPluginProvenanceOnlyActionId,
  type PluginActionInputById,
  type PluginActionResultById,
  type PluginInvocableActionId,
} from './actionSpecs.js';
import {
  PLUGIN_WEBHOOK_PLUGIN_SURFACE_ACTION_IDS_V1,
  PluginWebhookActionHttpPathsV1,
  PluginWebhookActionInputSchemasV1,
  PluginWebhookActionOutputSchemasV1,
  PluginWebhookPluginSurfaceActionHttpPathsV1,
  type PluginWebhookActionIdV1,
  type PluginWebhookPresentUserActionIdV1,
} from '../plugins/webhooks/endpointV1.js';

type PluginWebhookPluginActionIdV1 = Exclude<
  PluginWebhookActionIdV1,
  PluginWebhookPresentUserActionIdV1
>;

const PRESENT_USER_ACTION_IDS = [
  'plugin.webhook.endpoint.ensure',
  'plugin.webhook.endpoint.read',
  'plugin.webhook.endpoint.revoke',
  'plugin.webhook.endpoint.retarget',
  'plugin.webhook.delivery.movePending',
  'plugin.webhook.endpoint.credential.configure',
  'plugin.webhook.endpoint.credential.rotate',
  'plugin.webhook.endpoint.credential.finishRotation',
] as const;

describe('webhook endpoint ActionSpecs', () => {
  it('exposes lifecycle and Account-route credential operations only to present-user surfaces', () => {
    // Present-user authority is host-stamped, so openness never implies a
    // plugin caller can satisfy the Action: automation callers receive the
    // typed `present_user_required` failure instead of a hidden method.
    // `delivery.movePending` stays a host-internal delivery control and is
    // admitted on no caller surface beyond ui/cli hosts.
    const HOST_INTERNAL_PRESENT_USER_ACTION_IDS = [
      'plugin.webhook.delivery.movePending',
    ] as const;
    for (const actionId of PRESENT_USER_ACTION_IDS) {
      const spec = getActionSpec(actionId);
      expect(spec.requiredAuthority).toBe('present_user');
      const hostExposed = !HOST_INTERNAL_PRESENT_USER_ACTION_IDS.includes(
        actionId as (typeof HOST_INTERNAL_PRESENT_USER_ACTION_IDS)[number],
      );
      expect(spec.surfaces).toEqual(expect.objectContaining({
        ui: true,
        cli: true,
        ...(hostExposed ? { api: true, plugin: true } : { api: false, plugin: false }),
      }));
      expect(spec.inputSchema).toBeDefined();
      expect(spec.outputSchema).toBeDefined();
    }
  });

  it('keeps correspondence and target convergence on the plugin surface only', () => {
    expectTypeOf<Extract<PluginInvocableActionId, PluginWebhookPluginActionIdV1>>()
      .toEqualTypeOf<PluginWebhookPluginActionIdV1>();
    expectTypeOf<PluginActionInputById[PluginWebhookPluginActionIdV1]>()
      .toEqualTypeOf<z.input<typeof PluginWebhookActionInputSchemasV1[PluginWebhookPluginActionIdV1]>>();
    expectTypeOf<PluginActionResultById[PluginWebhookPluginActionIdV1]>()
      .toEqualTypeOf<z.output<typeof PluginWebhookActionOutputSchemasV1[PluginWebhookPluginActionIdV1]>>();
    // The plugin-surface family is exactly these two ids. Anything else added
    // to the webhook family stays present-user, so a new endpoint mutation
    // cannot silently acquire daemon-side plugin authority.
    expect([...PLUGIN_WEBHOOK_PLUGIN_SURFACE_ACTION_IDS_V1]).toEqual([
      'plugin.webhook.endpoint.checkCorrespondence',
      'plugin.webhook.endpoint.convergeTarget',
    ]);
    for (const actionId of PLUGIN_WEBHOOK_PLUGIN_SURFACE_ACTION_IDS_V1) {
      const spec = getActionSpec(actionId);
      expect(spec.requiredAuthority).toBe('account_automation');
      expect(spec.surfaces).toEqual(expect.objectContaining({
        ui: false,
        cli: false,
        plugin: true,
      }));
    }
  });

  /**
   * Convergence is the one endpoint mutation a feature owner may drive, so its
   * registry facts are pinned separately from the read-only correspondence
   * check: it is a `danger` write with a host-stamped plugin caller policy, it
   * carries no approval-result artifact, and it is never projected onto the
   * public API where an Account token could manufacture the plugin provenance
   * its authorization depends on.
   */
  it('declares target convergence as a host-stamped plugin write outside the public API', () => {
    const spec = getActionSpec('plugin.webhook.endpoint.convergeTarget');
    expect(spec.safety).toBe('danger');
    expect(spec.sideEffectClass).toBe('write');
    expect(spec.pluginCallerPolicy).toEqual({ kind: 'caller' });
    expect(spec.approval).toEqual({ result: 'none' });
    expect(spec.surfaces.api).toBe(false);
    expect(isPluginProvenanceOnlyActionId('plugin.webhook.endpoint.convergeTarget')).toBe(true);
    expect(PRESENT_USER_ACTION_IDS).not.toContain('plugin.webhook.endpoint.convergeTarget');
    expect(Object.keys(PluginWebhookActionHttpPathsV1))
      .not.toContain('plugin.webhook.endpoint.convergeTarget');
    expect(PluginWebhookPluginSurfaceActionHttpPathsV1['plugin.webhook.endpoint.convergeTarget'])
      .toBe('/v1/plugins/webhooks/endpoints/converge-target');
  });
});

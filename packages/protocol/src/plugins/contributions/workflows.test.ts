import { describe, expect, it } from 'vitest';
import { PluginContributesV2Schema } from './v2.js';
import { PLUGIN_CONTRIBUTION_CATALOG_V2, derivePluginDaemonContributionRegistrationRights } from './catalog.js';
import { WorkflowDefinitionV1Schema } from '../../workflows/workflowV1.js';
import { PluginManifestV2Schema } from '../manifest/v2.js';

const definition = WorkflowDefinitionV1Schema.parse({ version: 1, blocks: [{
  kind: 'wait', id: 'review', document: { text: 'Review the result.', references: [], attachments: [] },
  result: { kind: 'text' },
}] });

describe('declarative plugin workflows', () => {
  it('admits canonical workflow definitions and rejects malformed nested definitions', () => {
    const workflow = { id: 'review', title: 'Review the result', definition };
    const parsed = PluginContributesV2Schema.safeParse({ workflows: [workflow] });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data).toMatchObject({ workflows: [workflow] });
    expect(PluginContributesV2Schema.safeParse({ workflows: [{ ...workflow,
      definition: { ...definition, blocks: [{ ...definition.blocks[0], kind: 'unknown' }] },
    }] }).success).toBe(false);
  });

  it('uses the manifest catalog for read-only workflow declarations without executable registration rights', () => {
    const manifest = PluginManifestV2Schema.parse({ schemaVersion: 2, id: 'com.acme.workflows',
      version: '1.0.0', displayName: 'Workflows', runtime: { apiVersion: 1 },
      contributes: { workflows: [{ id: 'review', title: 'Review the result', definition }] },
    });
    const family = PLUGIN_CONTRIBUTION_CATALOG_V2.find((entry) => entry.manifestKey === 'workflows');
    expect(family).toMatchObject({ activationDemand: 'none', allowedRuntimeRegistration: null,
      projectionFamily: 'workflows' });
    expect(derivePluginDaemonContributionRegistrationRights(manifest)).toEqual([]);
  });
});

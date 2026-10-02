import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginProjectionV2Schema, WorkflowDefinitionV1Schema } from '@happier-dev/protocol';
import { normalizePluginManifestV2 } from '@/plugins/manifest/normalize';
import type { LoadedPlugin } from '@/plugins/discovery/load/installed';
import { createPluginRuntimeOccurrenceId } from '@/plugins/runtime/runtimeSlots';
import { projectLoadedPluginContributes } from './resolvePluginContributions';
import { createResolvedContributionRegistry, createMergedContributionRegistry } from './createResolvedContributionRegistry';
import { buildPluginProjectionV2 } from './projection/v2';
import { readPluginWorkflowSources } from './workflows';
import { resolveExecutablePluginRuntimeRegistry } from '@/plugins/runtime/resolveExecutablePluginRuntimeRegistry';

const definition = WorkflowDefinitionV1Schema.parse({ version: 1, blocks: [{ kind: 'wait', id: 'review',
    document: { text: 'Review the result.', references: [], attachments: [] }, result: { kind: 'text' },
}] });
const workflow = { id: 'review', title: 'Review the result', definition };

function loaded(pluginId: string): LoadedPlugin {
    const root = `/plugins/${pluginId}`;
    return { pluginId, pluginRootPath: root, manifestPath: `${root}/plugin.json`,
        daemonEntryPath: null, devDaemonEntryPath: null,
        sourceSpec: { kind: 'path', locator: root, trustPolicy: 'local_trusted', installPolicy: 'link' },
        manifest: normalizePluginManifestV2({ schemaVersion: 2, id: pluginId, version: '1.0.0', displayName: 'Workflows',
            runtime: { apiVersion: 1 }, contributes: { workflows: [workflow] },
        }),
    };
}

describe('plugin workflows through the canonical projection', () => {
    it('admits a workflows-only plugin without executable activation and fences its source with the occurrence', async () => {
        const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-plugin-workflows-'));
        const contributes = createResolvedContributionRegistry(projectLoadedPluginContributes({
            loadResult: { loadedPlugins: [loaded('com.acme.review')], diagnosticsByPluginId: {} }, provenance: 'first_party',
        }));
        const registry = await resolveExecutablePluginRuntimeRegistry({ happyHomeDir, contributes, generation: 1,
            generationAuthority: { commit: null, generations: new Map(), rejectedGenerations: new Map(), isCurrent: async () => true },
        });
        try {
            expect(readPluginWorkflowSources(registry.contributes)).toHaveLength(1);
            registry.fencePluginConsumers?.(['com.acme.review']);
            expect(readPluginWorkflowSources(registry.contributes)).toEqual([]);
            expect(registry.contributes.workflows).toEqual([]);
        } finally {
            await registry.dispose();
            await rm(happyHomeDir, { recursive: true, force: true });
        }
    });

    it('projects qualified definitions and version only while the source occurrence is current', () => {
        const pluginIds = ['com.acme.review', 'com.acme.other'];
        const inputs = projectLoadedPluginContributes({ loadResult: { loadedPlugins: pluginIds.map(loaded), diagnosticsByPluginId: {} }, provenance: 'first_party' });
        const registry = createResolvedContributionRegistry({ ...inputs,
            occurrenceIdsByPluginId: Object.fromEntries(pluginIds.map((id) => [id, createPluginRuntimeOccurrenceId(id)])),
        });
        const projection = buildPluginProjectionV2({ registry, generation: 1 });
        expect(PluginProjectionV2Schema.safeParse(projection).success).toBe(true);
        expect(projection.familiesById.workflows?.entriesById['com.acme.review/review']).toMatchObject({
            pluginId: 'com.acme.review', pluginVersion: '1.0.0', definition: workflow,
        });
        expect(readPluginWorkflowSources(registry)).toEqual(pluginIds.slice().reverse().map((pluginId) => ({
            workflow: `plugin:${pluginId}/review`, pluginId, version: '1.0.0',
            title: workflow.title, definition,
        })));
        expect(createMergedContributionRegistry({ workflows: registry.workflows }, {}).workflows).toEqual(registry.workflows);
        const withdrawn = createResolvedContributionRegistry({ ...inputs, occurrenceIdsByPluginId: {} });
        expect(readPluginWorkflowSources(withdrawn)).toEqual([]);
        expect(buildPluginProjectionV2({ registry: withdrawn, generation: 2 }).familiesById.workflows?.entriesById).toEqual({});
        const uninstalled = createResolvedContributionRegistry(projectLoadedPluginContributes({
            loadResult: { loadedPlugins: [], diagnosticsByPluginId: {} }, provenance: 'first_party',
        }));
        expect(buildPluginProjectionV2({ registry: uninstalled, generation: 3 }).familiesById.workflows?.entriesById).toEqual({});
        expect(readPluginWorkflowSources(uninstalled)).toEqual([]);
    });
});

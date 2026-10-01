import { describe, expect, it } from 'vitest';
import { PluginManifestV2Schema } from '@happier-dev/protocol';

import type { PluginSourceCustody } from '@/plugins/runtime/sourceAuthority';

import { projectReleaseLessPluginDeclarations } from './releaseLessDeclarations';

function manifest(id: string, contributes: Record<string, unknown>) {
    return PluginManifestV2Schema.parse({
        schemaVersion: 2,
        id,
        version: '3.1.0',
        displayName: id,
        engines: { happier: '^1.0.0' },
        runtime: { apiVersion: 1 },
        contributes,
    });
}

const EVENT = {
    id: 'message-received',
    kind: 'event',
    title: 'Message received',
    payloadSchema: { type: 'object', additionalProperties: false },
};

const BUNDLED: PluginSourceCustody = {
    kind: 'bundled_first_party',
    packagedRuntime: { kind: 'cli_version_root', versionRootId: 'cli-3.1.0' },
};
const DEVELOPMENT: PluginSourceCustody = { kind: 'development', registeredRootId: '/src/plugin' };
const MANAGED: PluginSourceCustody = {
    kind: 'managed',
    immutableGenerationId: 'generation-1',
    installSource: 'npm',
};

describe('release-less plugin declarations', () => {
    it('declares daemon-selected plugins with Account-scoped contributions and reports only the ones no registry record covers', () => {
        const declarations = projectReleaseLessPluginDeclarations({
            activationTargets: [
                { pluginId: 'acme.bundled', manifest: manifest('acme.bundled', { events: [EVENT] }) },
                { pluginId: 'acme.checkout', manifest: manifest('acme.checkout', { events: [EVENT] }) },
                { pluginId: 'acme.registered', manifest: manifest('acme.registered', { events: [EVENT] }) },
                { pluginId: 'acme.managed', manifest: manifest('acme.managed', { events: [EVENT] }) },
                { pluginId: 'acme.agent', manifest: manifest('acme.agent', {}) },
            ],
            sourceCustodiesByPluginId: new Map<string, PluginSourceCustody>([
                ['acme.bundled', BUNDLED],
                ['acme.checkout', DEVELOPMENT],
                ['acme.registered', DEVELOPMENT],
                ['acme.managed', MANAGED],
                ['acme.agent', BUNDLED],
            ]),
            registryMaterializationIdsByPluginId: {
                'acme.registered': 'registry-materialization',
                'acme.managed': 'managed-materialization',
            },
            observedAt: 1_700_000_000_000,
        });

        expect([...declarations.keys()]).toEqual(['acme.bundled', 'acme.checkout', 'acme.registered']);
        expect(declarations.get('acme.bundled')).toMatchObject({
            manifest: { id: 'acme.bundled', version: '3.1.0' },
            materializationId: 'daemon-selected:acme.bundled',
            runtimeMaterialization: {
                materializationId: 'daemon-selected:acme.bundled',
                pluginId: 'acme.bundled',
                version: '3.1.0',
                sourceClass: 'bundledFirstParty',
                portableRelease: false,
                enabled: true,
                trustState: 'trusted',
            },
        });
        expect(declarations.get('acme.checkout')?.runtimeMaterialization)
            .toMatchObject({ sourceClass: 'localPath', portableRelease: false });
        expect(declarations.get('acme.registered')).toMatchObject({
            materializationId: 'registry-materialization',
            runtimeMaterialization: null,
        });
    });
});

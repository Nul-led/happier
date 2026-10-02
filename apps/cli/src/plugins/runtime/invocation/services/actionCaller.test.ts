import { describe, expect, it } from 'vitest';

import {
    createPluginActionCallerCurrentnessCheck,
    resolvePluginActionCaller,
} from './actionCaller';
import { createPluginActionCallerMaterializationFixture } from './actionCaller.testkit';

describe('resolvePluginActionCaller', () => {
    it('rejects a malformed SDK Automation cause without falling back to a direct starter', () => {
        expect(resolvePluginActionCaller({
            plugin: { id: 'acme.plugin' },
            contribution: { id: 'action' },
            occurrenceId: 'occurrence-1',
            sourceCustody: { kind: 'development', registeredRootId: 'root-a' },
            initiatingActionCaller: { kind: 'host' },
            startedBy: 'user',
            caller: { kind: 'automationRun', runId: 'run-1', automationId: 'automation-1',
                cause: { kind: 'manual', invokedAt: Number.NaN } },
        })).toBeNull();
    });

    it('preserves host-stamped process occurrence and durable source custody', () => {
        const materialization = createPluginActionCallerMaterializationFixture('acme.plugin');

        expect(resolvePluginActionCaller({
            plugin: { id: 'acme.plugin' },
            occurrenceId: ' ',
            sourceCustody: { kind: 'development', registeredRootId: 'root-a' },
            resolveCurrentPluginMaterializationRef:
                materialization.resolveCurrentPluginMaterializationRef,
        })).toBeNull();

        expect(resolvePluginActionCaller({
            plugin: { id: 'acme.plugin' },
            contribution: { id: 'action' },
            occurrenceId: 'occurrence-1',
            sourceCustody: { kind: 'development', registeredRootId: 'root-a' },
            resolveCurrentPluginMaterializationRef:
                materialization.resolveCurrentPluginMaterializationRef,
        })).toEqual({
            kind: 'plugin',
            pluginId: 'acme.plugin',
            contributionLocalId: 'action',
            occurrenceId: 'occurrence-1',
            sourceCustody: { kind: 'development', registeredRootId: 'root-a' },
            materialization: materialization.materialization,
        });
    });

    it('keeps an originless caller occurrence-current without inventing materialization custody', async () => {
        const revalidateMaterialization = async () => {
            throw new Error('originless caller must not acquire materialization authority');
        };
        const revalidateOccurrence = async ({ occurrenceId }: Readonly<{ occurrenceId: string }>) => (
            occurrenceId === 'occurrence-bundled'
        );
        const caller = resolvePluginActionCaller({
            plugin: { id: 'happier.inspector' },
            contribution: { id: 'self-check' },
            occurrenceId: 'occurrence-bundled',
            sourceCustody: {
                kind: 'bundled_first_party',
                packagedRuntime: { kind: 'cli_version_root', versionRootId: 'cli-version-root-a' },
            },
        });

        expect(caller).toEqual({
            kind: 'plugin',
            pluginId: 'happier.inspector',
            contributionLocalId: 'self-check',
            occurrenceId: 'occurrence-bundled',
            sourceCustody: {
                kind: 'bundled_first_party',
                packagedRuntime: { kind: 'cli_version_root', versionRootId: 'cli-version-root-a' },
            },
        });
        if (!caller) throw new Error('expected originless caller');
        await expect(createPluginActionCallerCurrentnessCheck({
            caller,
            revalidateMaterialization,
            revalidateOccurrence,
        })()).resolves.toEqual({ kind: 'current' });
    });
});

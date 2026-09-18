import { describe, expect, it } from 'vitest';

import {
    resolveAgentScopedPluginSettingPresentation,
    resolveAgentScopedPluginSettingsDeclarations,
} from './agentScopedPluginSettingsDeclarations';
import { attachAgentPluginSettings, readAgentUiSetting } from './agentUiSettingLookup';

function field(key: string) {
    return {
        key,
        valueType: 'string',
        clearWhenEmpty: false,
        secretCustody: null,
        managedServiceOrigin: false,
        control: { kind: 'text' },
        valueSchema: { type: 'string' },
    } as any;
}

describe('resolveAgentScopedPluginSettingsDeclarations', () => {
    it('resolves one Agent-owned select from its existing localized Settings presentation', () => {
        const inputs = {
            pluginProjectionV2: {
                generation: 7,
                agentsById: {
                    opencode: { identity: { pluginId: 'opencode', localId: 'opencode' } },
                },
            },
            pluginProjectionById: {
                opencode: {
                    editableSettingsGroups: [{
                        id: 'agent-settings',
                        pluginId: 'opencode',
                        version: 1,
                        title: 'OpenCode',
                        scope: { kind: 'account' },
                        target: { kind: 'agent', agent: { pluginId: 'opencode', localId: 'opencode' } },
                        presentation: { sections: [], subagentSections: [] },
                        fields: [{
                            ...field('opencodeBackendMode'),
                            title: { key: 'mode.title', fallback: 'Backend mode' },
                            presentation: {
                                control: 'select',
                                options: [
                                    { value: 'server', title: { key: 'mode.server', fallback: 'Server fallback' } },
                                    { value: 'acp', title: { key: 'mode.acp', fallback: 'ACP fallback' } },
                                ],
                            },
                        }],
                    }],
                },
            },
        } as any;

        expect(resolveAgentScopedPluginSettingPresentation({
            agentId: 'opencode',
            setting: { scope: 'account', localId: 'opencodeBackendMode' },
            projectionInputs: inputs,
            localize: (_pluginId, value) => typeof value === 'string'
                ? value
                : ({
                    'mode.title': 'Mode du moteur',
                    'mode.server': 'Serveur',
                    'mode.acp': 'ACP historique',
                } as Record<string, string>)[value.key] ?? value.fallback,
        })).toEqual({
            title: 'Mode du moteur',
            options: [
                { value: 'server', title: 'Serveur' },
                { value: 'acp', title: 'ACP historique' },
            ],
        });
    });

    it('does not fall back from a qualified plugin setting to a same-named host setting', () => {
        const reference = { scope: 'account', localId: 'shared-local-id' } as const;
        expect(readAgentUiSetting({ sharedLocalId: 'host' }, reference)).toBeUndefined();
        expect(readAgentUiSetting(
            attachAgentPluginSettings(
                { sharedLocalId: 'host' },
                { account: { 'shared-local-id': 'plugin' } },
            ),
            reference,
        )).toBe('plugin');
    });

    it('isolates colliding local setting ids by qualified Agent identity', () => {
        const inputs = {
            pluginProjectionV2: {
                generation: 'registry-generation',
                agentsById: {
                    'plugin.alpha/agent': {
                        identity: { pluginId: 'plugin.alpha', localId: 'agent' },
                    },
                    'plugin.beta/agent': {
                        identity: { pluginId: 'plugin.beta', localId: 'agent' },
                    },
                },
            },
            pluginProjectionById: {
                'plugin.alpha': {
                    immutableGenerationId: 'alpha-generation',
                    editableSettingsGroups: [{
                        scope: { kind: 'account' },
                        target: { kind: 'agent', agent: { pluginId: 'plugin.alpha', localId: 'agent' } },
                        fields: [field('shared-local-id')],
                    }],
                },
                'plugin.beta': {
                    immutableGenerationId: 'beta-generation',
                    editableSettingsGroups: [{
                        scope: { kind: 'account' },
                        target: { kind: 'agent', agent: { pluginId: 'plugin.beta', localId: 'agent' } },
                        fields: [field('shared-local-id')],
                    }],
                },
            },
        } as any;

        const alpha = resolveAgentScopedPluginSettingsDeclarations({
            agentId: 'plugin.alpha/agent',
            projectionInputs: inputs,
        });
        const beta = resolveAgentScopedPluginSettingsDeclarations({
            agentId: 'plugin.beta/agent',
            projectionInputs: inputs,
        });

        expect(alpha.account).toMatchObject({
            pluginId: 'plugin.alpha',
            sourceLifetimeIdentity: 'agent-settings:plugin.alpha/agent:account:alpha-generation',
        });
        expect(beta.account).toMatchObject({
            pluginId: 'plugin.beta',
            sourceLifetimeIdentity: 'agent-settings:plugin.beta/agent:account:beta-generation',
        });
        expect(alpha.account?.fields).toHaveLength(1);
        expect(beta.account?.fields).toHaveLength(1);
    });

    it('combines same-scope declaration groups without admitting another Agent', () => {
        const inputs = {
            pluginProjectionV2: {
                generation: 'registry-generation',
                agentsById: {
                    'plugin.alpha/agent': {
                        identity: { pluginId: 'plugin.alpha', localId: 'agent' },
                    },
                },
            },
            pluginProjectionById: {
                'plugin.alpha': {
                    immutableGenerationId: 'alpha-generation',
                    editableSettingsGroups: [
                        {
                            scope: { kind: 'daemon' },
                            target: { kind: 'agent', agent: { pluginId: 'plugin.alpha', localId: 'agent' } },
                            fields: [field('one')],
                        },
                        {
                            scope: { kind: 'daemon' },
                            target: { kind: 'agent', agent: { pluginId: 'plugin.alpha', localId: 'agent' } },
                            fields: [field('two')],
                        },
                        {
                            scope: { kind: 'daemon' },
                            target: { kind: 'agent', agent: { pluginId: 'plugin.alpha', localId: 'other' } },
                            fields: [field('foreign')],
                        },
                    ],
                },
            },
        } as any;

        const declarations = resolveAgentScopedPluginSettingsDeclarations({
            agentId: 'plugin.alpha/agent',
            projectionInputs: inputs,
        });

        expect(declarations.daemon?.fields.map((entry) => entry.key)).toEqual(['one', 'two']);
        expect(declarations.account).toBeNull();
    });
});

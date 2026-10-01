import { describe, expect, it } from 'vitest';

import { normalizeActionsSettingsV1, type PluginSettingsContributionV2 } from '@happier-dev/protocol';

import { createProductionPluginInvocationServiceOwners } from './production';

const accountSettingsDeclaration: PluginSettingsContributionV2 = {
    id: 'account-preferences',
    version: 1,
    title: 'Account preferences',
    target: { kind: 'plugin' },
    scope: 'account',
    fields: [{
        id: 'endpoint',
        title: 'Endpoint',
        schema: { type: 'string' },
    }],
    presentation: { sections: [], subagentSections: [] },
};

describe('production invocation services for a scoped principal', () => {
    it('keeps ambient Account settings and secrets unavailable without a scoped Account-state producer', () => {
        const actionsSettingsProvider = {
            getActionsSettings: () => normalizeActionsSettingsV1({ v: 1, actions: {} }),
        };
        const owners = createProductionPluginInvocationServiceOwners({
            loggerSink: { write: () => {} },
            accountCredentialAuthority: {
                readCredentials: async () => ({ token: 'scoped-token', encryption: null }),
                actionsSettingsProvider,
            },
            settingsDeclarations: [{
                pluginId: 'acme.plugin',
                contribution: accountSettingsDeclaration,
            }],
            secretDeclarations: [{
                pluginId: 'acme.plugin',
                declaration: { id: 'account-token', custody: 'account' },
            }],
        });
        const services = owners.createServices({
            plugin: { id: 'acme.plugin', version: '1.0.0' },
            contribution: { id: 'run', qualifiedId: 'acme.plugin/actions/run' },
            occurrenceId: 'occurrenceId-1',
            correlationId: 'correlation-1',
            surface: 'cli',
            signal: new AbortController().signal,
            isOccurrenceCurrent: () => true,
        }, owners.createOrdinaryServiceBinding('occurrenceId-1', 'binding-1'));

        expect(services.availability('settings')).toEqual({
            status: 'unavailable',
            code: 'plugin_service_unavailable',
        });
        expect(services.availability('secrets')).toEqual({
            status: 'unavailable',
            code: 'plugin_service_unavailable',
        });
    });
});

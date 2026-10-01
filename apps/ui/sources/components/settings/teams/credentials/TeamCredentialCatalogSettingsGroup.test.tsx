import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectRenderedTestIds, renderScreen, standardCleanup } from '@/dev/testkit';

import { TeamCredentialCatalogSettingsGroup } from './TeamCredentialCatalogSettingsGroup';

afterEach(standardCleanup);

describe('TeamCredentialCatalogSettingsGroup', () => {
    it('shows one applicable least-privilege resource and opens it by canonical identity', async () => {
        const onOpen = vi.fn();
        const provider = {
            id: 'resource-provider', teamId: 'team-1', displayName: 'Acme Provider', resourceRevision: 7,
            readiness: { kind: 'available' as const }, recoveryAction: null, deliveryMode: 'brokered' as const,
            mayBroker: true, mayReceiveDirect: false, directMaterialState: 'never_delivered' as const,
            sessionUsePolicy: 'personal_allowed' as const, providerModels: [], connectedServiceSelections: [],
            sourcePresentation: {
                kind: 'provider' as const,
                provider: { identity: { pluginId: 'openrouter', localId: 'openrouter' }, definitionRevision: 1 as const },
            },
        };
        const connected = {
            ...provider,
            id: 'resource-connected',
            sourcePresentation: {
                kind: 'connected_service' as const,
                service: { pluginId: 'github', localId: 'github' },
            },
        };
        const screen = await renderScreen(
            <TeamCredentialCatalogSettingsGroup
                title="Provided by Teams"
                sourceKind="provider"
                catalog={{
                    resources: [provider, provider, connected],
                    teamNameById: { 'team-1': 'Acme' },
                    homeNameByTeamId: { 'team-1': 'Home A' },
                    currentResourceKeys: new Set(['team-1:resource-provider', 'team-1:resource-connected']),
                    current: true,
                    reload: async () => undefined,
                }}
                onOpen={onOpen}
            />,
        );

        expect(collectRenderedTestIds(screen.tree.toJSON()))
            .toEqual(['team-credential-catalog-resource:team-1:resource-provider']);
        screen.pressByTestId('team-credential-catalog-resource:team-1:resource-provider');
        expect(onOpen).toHaveBeenCalledWith(provider);
    });

    it('retains stale rows but prevents navigation until exact currentness returns', async () => {
        const onOpen = vi.fn();
        const onRetry = vi.fn();
        const resource = {
            id: 'resource-provider', teamId: 'team-1', displayName: 'Acme Provider', resourceRevision: 7,
            readiness: { kind: 'available' as const }, recoveryAction: 'retry' as const, deliveryMode: 'direct' as const,
            mayBroker: false, mayReceiveDirect: true, directMaterialState: 'stale' as const,
            sessionUsePolicy: 'personal_allowed' as const, providerModels: [], connectedServiceSelections: [],
            sourcePresentation: {
                kind: 'provider' as const,
                provider: { identity: { pluginId: 'openrouter', localId: 'openrouter' }, definitionRevision: 1 as const },
            },
        };
        const screen = await renderScreen(
            <TeamCredentialCatalogSettingsGroup
                title="Provided by Teams"
                sourceKind="provider"
                catalog={{
                    resources: [resource], teamNameById: { 'team-1': 'Acme' },
                    homeNameByTeamId: { 'team-1': 'Home A' }, currentResourceKeys: new Set(), current: false,
                    reload: async () => undefined,
                }}
                onRetry={onRetry}
                onOpen={onOpen}
            />,
        );

        expect(screen.getTextContent()).toContain('Showing the last known data for this Home.');
        expect(screen.findByTestId('team-credential-catalog-resource:team-1:resource-provider')?.props.onPress).toBeUndefined();
        screen.pressByTestId('team-credential-catalog-retry:provider');
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps an empty stale catalog actionable instead of presenting it as no shared credentials', async () => {
        const onRetry = vi.fn();
        const screen = await renderScreen(
            <TeamCredentialCatalogSettingsGroup
                title="Provided by Teams"
                sourceKind="provider"
                catalog={{
                    resources: [], teamNameById: {}, homeNameByTeamId: {}, currentResourceKeys: new Set(), current: false,
                    reload: async () => undefined,
                }}
                onRetry={onRetry}
                onOpen={() => undefined}
            />,
        );

        expect(screen.getTextContent()).toContain('Showing the last known data for this Home.');
        screen.pressByTestId('team-credential-catalog-retry:provider');
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('says the section is showing last known data once, not in its title and again in its description', async () => {
        const screen = await renderScreen(
            <TeamCredentialCatalogSettingsGroup
                title="Shared with you"
                sourceKind="connected_service"
                catalog={{
                    resources: [], teamNameById: {}, homeNameByTeamId: {}, currentResourceKeys: new Set(), current: false,
                    reload: async () => undefined,
                }}
                onRetry={() => undefined}
                onOpen={() => undefined}
            />,
        );

        const occurrences = screen.getTextContent().split('Showing the last known data for this Home.').length - 1;
        expect(occurrences).toBe(1);
        expect(screen.getTextContent()).toContain('Shared with you');
    });

    it('keeps an exact current repair row reachable while another catalog slice is stale', async () => {
        const onOpen = vi.fn();
        const resource = {
            id: 'resource-provider', teamId: 'team-1', displayName: 'Acme Provider', resourceRevision: 7,
            readiness: { kind: 'source_unavailable' as const }, recoveryAction: 'retry' as const,
            deliveryMode: 'direct' as const, mayBroker: false, mayReceiveDirect: true,
            directMaterialState: 'stale' as const, sessionUsePolicy: 'personal_allowed' as const, providerModels: [], connectedServiceSelections: [],
            sourcePresentation: {
                kind: 'provider' as const,
                provider: { identity: { pluginId: 'openrouter', localId: 'openrouter' }, definitionRevision: 1 as const },
            },
        };
        const screen = await renderScreen(
            <TeamCredentialCatalogSettingsGroup
                title="Provided by Teams"
                sourceKind="provider"
                catalog={{
                    resources: [resource], teamNameById: { 'team-1': 'Acme' }, homeNameByTeamId: { 'team-1': 'Home A' },
                    currentResourceKeys: new Set(['team-1:resource-provider']), current: false,
                    reload: async () => undefined,
                }}
                onOpen={onOpen}
            />,
        );

        screen.pressByTestId('team-credential-catalog-resource:team-1:resource-provider');
        expect(onOpen).toHaveBeenCalledWith(resource);
    });
});

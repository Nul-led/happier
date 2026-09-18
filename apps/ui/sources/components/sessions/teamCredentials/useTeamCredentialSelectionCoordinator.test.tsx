import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamCredentialResourceCatalogEntryV1Schema } from '@happier-dev/protocol/teams';

import { renderHook } from '@/dev/testkit';

const confirmMock = vi.hoisted(() => vi.fn(async () => true));
const alertMock = vi.hoisted(() => vi.fn());

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { confirm: confirmMock, alert: alertMock } }).module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

const selection = Object.freeze({ resourceId: 'resource-1', modelId: 'model-1' });

function resource(
    directMaterialState: 'never_delivered' | 'preparing' | 'current' | 'stale' | 'revoked' = 'never_delivered',
) {
    return TeamCredentialResourceCatalogEntryV1Schema.parse({
        id: 'resource-1', teamId: 'team-1', displayName: 'Shared provider', resourceRevision: 4,
        readiness: { kind: 'available' }, recoveryAction: null,
        mayBroker: true, mayReceiveDirect: true,
        directMaterialState, sessionUsePolicy: 'personal_allowed', providerModels: [],
        connectedServiceSelections: [],
        sourcePresentation: {
            kind: 'provider',
            provider: { identity: { pluginId: 'provider.test', localId: 'shared' }, definitionRevision: 1 },
        },
    });
}

describe('useTeamCredentialSelectionCoordinator', () => {
    beforeEach(() => {
        confirmMock.mockReset();
        confirmMock.mockResolvedValue(true);
        alertMock.mockReset();
    });

    it('bypasses disclosure for brokered selection and returns the exact original selection', async () => {
        const { useTeamCredentialSelectionCoordinator } = await import('./useTeamCredentialSelectionCoordinator');
        const hook = await renderHook(() => useTeamCredentialSelectionCoordinator('home-1'));
        const outcome = await hook.getCurrent()({ resource: resource('current'), deliveryMode: 'brokered', selection, isCurrent: () => true });
        expect(confirmMock).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({ kind: 'continue', selection });
        if (outcome.kind === 'continue') expect(outcome.selection).toBe(selection);
    });

    it('returns cancel without selection after the first direct-use disclosure is declined', async () => {
        confirmMock.mockResolvedValue(false);
        const { useTeamCredentialSelectionCoordinator } = await import('./useTeamCredentialSelectionCoordinator');
        const hook = await renderHook(() => useTeamCredentialSelectionCoordinator('home-1'));
        const outcome = await hook.getCurrent()({ resource: resource(), deliveryMode: 'direct', selection, isCurrent: () => true });
        expect(confirmMock).toHaveBeenCalledWith(
            'teams.credentials.directUse.title',
            'teams.credentials.directUse.body',
            {
                confirmText: 'common.continue',
                cancelText: 'common.cancel',
            },
        );
        expect(outcome.kind).toBe('cancel');
        expect(outcome).not.toHaveProperty('selection');
    });

    it('invalidates a pending confirmation when Home identity changes', async () => {
        let resolveConfirmation: (confirmed: boolean) => void = () => {};
        confirmMock.mockReturnValue(new Promise<boolean>((resolve) => { resolveConfirmation = resolve; }));
        const { useTeamCredentialSelectionCoordinator } = await import('./useTeamCredentialSelectionCoordinator');
        const hook = await renderHook(({ homeId }) => useTeamCredentialSelectionCoordinator(homeId), {
            initialProps: { homeId: 'home-1' },
        });
        const pending = hook.getCurrent()({ resource: resource(), deliveryMode: 'direct', selection, isCurrent: () => true });
        await hook.rerender({ homeId: 'home-2' });
        act(() => resolveConfirmation(true));
        await expect(pending).resolves.toMatchObject({ kind: 'invalidated' });
        // The surface that asked is no longer the surface in front of the
        // person; an alert about another Home's resource would be noise.
        expect(alertMock).not.toHaveBeenCalled();
    });

    it('explains a resource that changed under a confirmed selection instead of doing nothing', async () => {
        const { useTeamCredentialSelectionCoordinator } = await import('./useTeamCredentialSelectionCoordinator');
        const hook = await renderHook(() => useTeamCredentialSelectionCoordinator('home-1'));
        const outcome = await hook.getCurrent()({
            resource: resource(),
            deliveryMode: 'direct',
            selection,
            isCurrent: () => false,
        });
        expect(outcome.kind).toBe('invalidated');
        // The person confirmed the disclosure and the selection still did not
        // take: silence here reads as a dead control.
        expect(alertMock).toHaveBeenCalledWith('common.error', 'teams.credentials.edit.conflict');
    });

    it.each(['preparing', 'current', 'stale', 'revoked'] as const)(
        'does not repeat the disclosure after retained history projects %s',
        async (directMaterialState) => {
            const { useTeamCredentialSelectionCoordinator } = await import('./useTeamCredentialSelectionCoordinator');
            const hook = await renderHook(() => useTeamCredentialSelectionCoordinator('home-1'));
            const outcome = await hook.getCurrent()({ resource: resource(directMaterialState), deliveryMode: 'direct', selection, isCurrent: () => true });
            expect(confirmMock).not.toHaveBeenCalled();
            expect(outcome.kind).toBe('continue');
        },
    );
});

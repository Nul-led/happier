import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_ROLES_V1 } from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit';
import { createSessionFixture, createSessionAccessFixture } from '@/dev/testkit/fixtures/sessionFixtures';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** The Action front door is the boundary the role catalog reads through (`roles.list`). */
const shared = vi.hoisted(() => ({ metadata: null as unknown }));

vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => async (actionId: string) => {
        if (actionId === 'roles.list') {
            return { ok: true, result: { items: [
                { roleId: 'orchestrator', role: BUILT_IN_ROLES_V1.orchestrator, shared: false, viewOnly: false, migratedFromV0_2: false },
                { roleId: 'builder', role: BUILT_IN_ROLES_V1.builder, shared: false, viewOnly: false, migratedFromV0_2: false },
            ] } };
        }
        return { ok: true, result: { updated: true } };
    },
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createLiveStorageStoreMock, createStorageModuleMock, createUseSettingMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleMock({
        importOriginal,
        overrides: {
            storage: createLiveStorageStoreMock(() => ({
                sessions: { lead: { id: 'lead', metadata: shared.metadata } } as never,
            })),
            useSetting: createUseSettingMock({
                fallback: (key: string) => {
                    if (key === 'rolesV1') return { overrides: {} };
                    if (key === 'acpCatalogSettingsV1') return { v: 2, backends: [] };
                    if (key === 'backendEnabledByTargetKey') return {};
                    return undefined;
                },
            }),
            useSessionMetadata: () => shared.metadata as never,
            useActiveServerAccountScope: () => ({ serverId: 'server-1', accountId: 'account-1' }),
        },
    });
});

const { SessionRoleValueRow, isSessionRoleSnapshotCopiedAcrossOwners } = await import('./sessionRole');
const { invalidateRoleCatalog } = await import('@/components/roles/catalog/useRoleCatalog');

/** The composite that declared a testID (not the host it painted), for reading its declared props. */
function declared(screen: { findAll: (predicate: (node: any) => boolean) => any[] }, testID: string, prop: string) {
    return screen.findAll((node: any) => node.props?.testID === testID && node.props?.[prop] !== undefined)[0] ?? null;
}

function sessionRoles(roleId: string | null, overrides: Record<string, unknown> = {}) {
    return { work: { sessionRolesV1: { ...(roleId ? { roleId } : {}), overrides, sessionRoles: {}, notes: '' } } };
}

describe('Session Role value row (Work tab top row)', () => {
    beforeEach(() => {
        invalidateRoleCatalog();
    });

    it('compares the inherited lead and worker owners rather than treating all inheritance as cross-owner', () => {
        const metadata = { path: '/repo', host: 'test', work: { sessionRolesV1: {
            inheritedFrom: 'lead', overrides: {}, sessionRoles: {}, notes: 'Snapshot',
        } } };
        const worker = createSessionFixture({ id: 'worker', serverId: 'home', owner: 'worker-owner', metadata });
        const lead = createSessionFixture({ id: 'lead', serverId: 'home', owner: 'lead-owner' });
        expect(isSessionRoleSnapshotCopiedAcrossOwners(worker, lead, 'worker-owner')).toBe(true);
        expect(isSessionRoleSnapshotCopiedAcrossOwners({ ...worker, owner: 'lead-owner' }, lead, 'lead-owner')).toBe(false);
        expect(isSessionRoleSnapshotCopiedAcrossOwners({ ...worker, metadata: null }, lead, 'worker-owner')).toBe(false);
        expect(isSessionRoleSnapshotCopiedAcrossOwners(worker, { ...lead, serverId: 'other-home' }, 'worker-owner')).toBe(false);
        const ownWorker = { ...worker, owner: undefined, access: createSessionAccessFixture('owner') };
        const receivedLead = { ...lead, access: createSessionAccessFixture('edit') };
        expect(isSessionRoleSnapshotCopiedAcrossOwners(ownWorker, receivedLead, 'worker-owner')).toBe(true);
        expect(isSessionRoleSnapshotCopiedAcrossOwners({ ...worker, access: createSessionAccessFixture('edit') },
            { ...lead, owner: undefined, access: createSessionAccessFixture('owner') }, 'lead-owner')).toBe(true);
        expect(isSessionRoleSnapshotCopiedAcrossOwners(ownWorker,
            { ...lead, owner: undefined, access: createSessionAccessFixture('owner') }, 'worker-owner')).toBe(false);
    });

    it('names the session\'s role with hands-off as its attribute, and opens the Role popover', async () => {
        shared.metadata = sessionRoles('orchestrator');
        const screen = await renderScreen(<SessionRoleValueRow sessionId="lead" testID="session-work-role" />);

        expect(declared(screen, 'session-work-role', 'detail')!.props.detail).toBe('Orchestrator · sessionWork.role.handsOff');

        await act(async () => {
            declared(screen, 'session-work-role', 'onPress')!.props.onPress();
        });
        expect(screen.findAll((node: any) => node.props?.anchorRef !== undefined && node.props?.onRequestClose !== undefined).length)
            .toBeGreaterThan(0);
    });

    it('drops hands-off when the session relaxed it, and says None without a role', async () => {
        shared.metadata = sessionRoles('orchestrator', { orchestrator: { roleId: 'orchestrator', workspaceWrites: 'allow' } });
        const relaxed = await renderScreen(<SessionRoleValueRow sessionId="lead" testID="session-work-role" />);
        expect(declared(relaxed, 'session-work-role', 'detail')!.props.detail).toBe('Orchestrator');

        shared.metadata = sessionRoles(null);
        const none = await renderScreen(<SessionRoleValueRow sessionId="lead" testID="session-work-role" />);
        expect(declared(none, 'session-work-role', 'detail')!.props.detail).toBe('sessionWork.role.none');
    });

    it('keeps a copied Role inspectable as text without opening a mutation popover', async () => {
        shared.metadata = sessionRoles('orchestrator');
        const screen = await renderScreen(<SessionRoleValueRow sessionId="lead" copiedAtSpawn testID="session-work-role" />);
        expect(declared(screen, 'session-work-role', 'detail')!.props.detail).toBe('Orchestrator · sessionWork.role.handsOff');
        expect(declared(screen, 'session-work-role', 'onPress')).toBeNull();
    });
});

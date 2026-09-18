import * as React from 'react';

import { Modal } from '@/modal';
import { t } from '@/text';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { getActiveServerId, resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import type { ServerSelectionGroup } from '@/sync/domains/server/selection/serverSelectionTypes';

import type { ServerAuthStatus } from './useServerAuthStatusByServerId';
import type { ActiveServerSwitchResult } from '@/sync/domains/server/activeServerSwitch';
import type { HomeViewSelectionSettings } from '@/hooks/server/useHomeViewSelectionSettings';
import { normalizeServerSelectionGroupsForSettings } from '@/sync/domains/server/selection/serverSelectionSettingsAdapter';
import { resolveServerSelectionGroupActivation } from '@/sync/domains/server/selection/serverSelectionActivation';

function toGroupProfileId(rawName: string): string {
    const base = String(rawName ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
    return base || `group-${Date.now()}`;
}

function findServerProfileByScopeId(
    profiles: ReadonlyArray<ServerProfile>,
    id: string,
): ServerProfile | null {
    return profiles.find((server) => server.id === id || resolveServerProfileScopeId(server) === id) ?? null;
}

async function resolveServerAuthStatus(params: Readonly<{
    servers: ReadonlyArray<ServerProfile>;
    authStatusByServerId: Readonly<Record<string, ServerAuthStatus>>;
    serverId: string;
}>): Promise<ServerAuthStatus> {
    const profile = findServerProfileByScopeId(params.servers, params.serverId);
    const known = params.authStatusByServerId[params.serverId]
        ?? (profile ? params.authStatusByServerId[profile.id] : undefined)
        ?? 'unknown';
    if (known !== 'unknown' || !profile) return known;
    try {
        const credentials = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, { serverId: profile.id });
        return credentials ? 'signedIn' : 'signedOut';
    } catch {
        return 'unknown';
    }
}

export function useServerSettingsGroupActions(params: Readonly<{
    servers: ReadonlyArray<ServerProfile>;
    activeServerId: string;
    validServerIds: ReadonlySet<string>;
    authStatusByServerId: Readonly<Record<string, ServerAuthStatus>>;

    normalizedGroupProfiles: ReadonlyArray<ServerSelectionGroup>;
    activeGroupId: string | null;
    groupPresentation: 'grouped' | 'flat-with-badge';
    selectionScope: 'tab' | 'device';

    setRevision: React.Dispatch<React.SetStateAction<number>>;
    onSwitchServerById: (serverId: string) => Promise<ActiveServerSwitchResult>;
    onAfterSignedOutSwitch: () => void;

    setHomeViewSelectionSettings: (
        update: (current: HomeViewSelectionSettings) => HomeViewSelectionSettings,
        options?: Readonly<{ targetScope?: 'tab' | 'device' }>,
    ) => Promise<void>;
}>) {
    const onSwitchGroup = React.useCallback(async (profile: ServerSelectionGroup) => {
        const nextServerIds = Array.from(new Set(profile.serverIds.map((id) => String(id ?? '').trim()).filter(Boolean)));
        if (nextServerIds.length === 0) {
            Modal.alert(t('common.error'), t('server.serverGroupMustHaveServer'));
            return;
        }

        const activation = await resolveServerSelectionGroupActivation({
            currentServerId: params.activeServerId,
            serverIds: nextServerIds,
            resolveAuthStatus: async (serverId) => await resolveServerAuthStatus({
                servers: params.servers,
                authStatusByServerId: params.authStatusByServerId,
                serverId,
            }),
        });
        if (!activation) return;
        const { serverId: nextServerId, authStatus } = activation;
        // Auth resolution above may await credential storage while another action
        // changes focus. Compare with the canonical applied Home at switch time.
        if (nextServerId !== getActiveServerId()) {
            const result = await params.onSwitchServerById(nextServerId);
            if (result === 'blocked') return;
        }
        await params.setHomeViewSelectionSettings((current) => ({
            ...current,
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: profile.id,
        }), { targetScope: params.selectionScope });
        if (authStatus === 'signedOut') {
            params.onAfterSignedOutSwitch();
        }
        params.setRevision((r) => r + 1);
    }, [params]);

    const onRenameGroup = React.useCallback(async (profile: ServerSelectionGroup) => {
        const next = await Modal.prompt(
            t('server.renameServerGroup'),
            t('server.renameServerGroupPrompt'),
            { defaultValue: profile.name, placeholder: t('server.serverGroupNamePlaceholder') },
        );
        if (!next) return;
        const trimmed = next.trim();
        if (!trimmed) return;
        // The prompt awaited above; another writer may have changed groups meanwhile.
        // Derive the mutation from the state present at commit instead of the
        // snapshot this callback captured.
        await params.setHomeViewSelectionSettings((current) => {
            const groups = normalizeServerSelectionGroupsForSettings(current.serverSelectionGroups);
            if (!groups.some((item) => item.id === profile.id)) return current;
            return {
                ...current,
                serverSelectionGroups: groups.map((item) => item.id !== profile.id ? item : { ...item, name: trimmed }),
            };
        }, { targetScope: params.selectionScope });
    }, [params]);

    const onRemoveGroup = React.useCallback(async (profile: ServerSelectionGroup) => {
        const confirmed = await Modal.confirm(
            t('server.removeServerGroup'),
            t('server.removeServerGroupConfirm', { name: profile.name }),
            { confirmText: t('common.remove'), destructive: true },
        );
        if (!confirmed) return;
        const activeServerId = getActiveServerId();

        // The confirmation awaited above; only the removed group is dropped from the
        // state present at commit, and the fallback target is derived from that
        // current target rather than the captured one.
        await params.setHomeViewSelectionSettings((current) => {
            const groups = normalizeServerSelectionGroupsForSettings(current.serverSelectionGroups)
                .filter((item) => item.id !== profile.id);
            const removedCurrentTarget = current.serverSelectionActiveTargetKind === 'group'
                && current.serverSelectionActiveTargetId === profile.id;
            return {
                ...current,
                serverSelectionGroups: groups,
                ...(removedCurrentTarget ? {
                    serverSelectionActiveTargetKind: activeServerId ? 'server' as const : null,
                    serverSelectionActiveTargetId: activeServerId || null,
                } : {}),
            };
        }, { targetScope: params.selectionScope });
    }, [params]);

    const onCreateServerGroup = React.useCallback(async (input: { name: string; serverIds: string[] }) => {
        const trimmedName = String(input.name ?? '').trim();
        const nextServerIds = Array.from(new Set((input.serverIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)));
        if (!trimmedName) return false;
        if (nextServerIds.length === 0) {
            Modal.alert(t('common.error'), t('server.serverGroupMustHaveServer'));
            return false;
        }

        const baseId = toGroupProfileId(trimmedName);

        const activation = await resolveServerSelectionGroupActivation({
            currentServerId: params.activeServerId,
            serverIds: nextServerIds,
            resolveAuthStatus: async (serverId) => await resolveServerAuthStatus({
                servers: params.servers,
                authStatusByServerId: params.authStatusByServerId,
                serverId,
            }),
        });
        if (!activation) return false;
        const { serverId: nextServerId, authStatus } = activation;
        // Auth resolution may await credential storage. Compare against the
        // canonical applied Home now, not the render-time focus.
        if (nextServerId !== getActiveServerId()) {
            const result = await params.onSwitchServerById(nextServerId);
            if (result === 'blocked') return false;
        }
        // The auth probe and focus switch awaited above: allocate the group id
        // against the groups present at commit so a concurrently created group
        // with the same derived id is neither overwritten nor dropped.
        await params.setHomeViewSelectionSettings((current) => {
            const groups = normalizeServerSelectionGroupsForSettings(current.serverSelectionGroups);
            const existingIds = new Set(groups.map((group) => group.id));
            let id = baseId;
            let suffix = 2;
            while (existingIds.has(id)) {
                id = `${baseId}-${suffix}`;
                suffix += 1;
            }
            const nextGroup: ServerSelectionGroup = {
                id,
                name: trimmedName,
                serverIds: nextServerIds,
                presentation: params.groupPresentation,
            };
            return {
                ...current,
                serverSelectionGroups: normalizeServerSelectionGroupsForSettings([...groups, nextGroup]),
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: id,
            };
        }, { targetScope: params.selectionScope });
        if (authStatus === 'signedOut') {
            params.onAfterSignedOutSwitch();
        }
        params.setRevision((r) => r + 1);
        return true;
    }, [params]);

    return {
        onSwitchGroup,
        onRenameGroup,
        onRemoveGroup,
        onCreateServerGroup,
    } as const;
}

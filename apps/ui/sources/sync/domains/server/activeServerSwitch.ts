import { switchConnectionToActiveServer } from '../../runtime/orchestration/connectionManager';
import { presentFirstKeyCredentialLifecycle } from '@/components/account/presentFirstKeyCredentialLifecycle';
import { guardAccountEncryptionFirstKeyCredentialMutation } from '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth';
import { getActiveServerSnapshot, setActiveServer, upsertAndActivateServer } from './serverRuntime';
import {
    adoptHomeProfile,
    areServerProfileIdentifiersEquivalent,
    clearTabActiveServerId,
    getDeviceDefaultServerId,
    getTabActiveServerId,
} from './serverProfiles';
import type { ServerProfileSource } from './serverProfiles';
import { canonicalizeServerUrl, createServerUrlComparableKey } from './url/serverUrlCanonical';

export { upsertAndActivateServer } from './serverRuntime';

export type ActiveServerSwitchResult = 'switched' | 'already_active' | 'blocked';

export function normalizeServerUrl(raw: string): string {
    return canonicalizeServerUrl(raw);
}

export function defaultServerNameFromUrl(rawUrl: string): string {
    const url = normalizeServerUrl(rawUrl);
    try {
        const parsed = new URL(url);
        if (!parsed.hostname) return url;
        return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    } catch {
        return url;
    }
}

export function isSameServerUrl(left: string, right: string): boolean {
    const leftKey = createServerUrlComparableKey(left);
    if (!leftKey) return false;
    return leftKey === createServerUrlComparableKey(right);
}

async function presentRetainedTargetCustody(): Promise<void> {
    const target = getActiveServerSnapshot();
    await presentFirstKeyCredentialLifecycle({
        run: async () => {
            const guard =
                await guardAccountEncryptionFirstKeyCredentialMutation({
                    serverUrl: target.serverUrl,
                    serverId: target.serverId,
                });
            return guard.kind === 'allowed'
                ? { kind: 'completed' }
                : guard;
        },
    });
}

async function runGuardedActiveServerSwitch(
    run: () => Promise<void>,
): Promise<Exclude<ActiveServerSwitchResult, 'already_active'>> {
    let switched = false;
    await presentFirstKeyCredentialLifecycle({
        run: async () => {
            const guard =
                await guardAccountEncryptionFirstKeyCredentialMutation();
            if (guard.kind !== 'allowed') {
                return guard;
            }
            await run();
            switched = true;
            return { kind: 'completed' };
        },
    });
    if (switched) {
        await presentRetainedTargetCustody();
    }
    return switched ? 'switched' : 'blocked';
}

function canSkipActiveServerUrlSwitch(params: Readonly<{
    activeServerUrl: string;
    targetServerUrl: string;
    scope: 'device' | 'tab';
}>): boolean {
    if (!isSameServerUrl(params.activeServerUrl, params.targetServerUrl)) return false;
    if (params.scope === 'tab') return true;
    return !getTabActiveServerId();
}

function canSkipActiveServerIdSwitch(params: Readonly<{
    activeServerId: string;
    targetServerId: string;
    scope: 'device' | 'tab';
}>): boolean {
    if (!areServerProfileIdentifiersEquivalent(params.activeServerId, params.targetServerId)) return false;
    if (params.scope === 'tab') return true;
    return !getTabActiveServerId()
        && areServerProfileIdentifiersEquivalent(getDeviceDefaultServerId(), params.targetServerId);
}

async function stageActiveServerAndSwitch(
    stage: () => void,
    refreshAuth?: () => Promise<void>,
): Promise<void> {
    const previousDeviceServerId = getDeviceDefaultServerId();
    const previousTabServerId = getTabActiveServerId();
    stage();

    try {
        await switchConnectionToActiveServer();
        await refreshAuth?.();
    } catch (switchError) {
        try {
            setActiveServer({ serverId: previousDeviceServerId, scope: 'device' });
            if (previousTabServerId) {
                setActiveServer({ serverId: previousTabServerId, scope: 'tab' });
            } else {
                clearTabActiveServerId();
            }
            await switchConnectionToActiveServer();
        } catch (rollbackError) {
            throw new AggregateError(
                [switchError, rollbackError],
                'Active server switch failed and the previous connection could not be restored.',
            );
        }
        throw switchError;
    }
}

export async function upsertActivateAndSwitchServer(params: Readonly<{
    serverUrl: string;
    source?: ServerProfileSource;
    scope?: 'device' | 'tab';
    name?: string;
    refreshAuth?: (() => Promise<void>) | null;
}>): Promise<ActiveServerSwitchResult> {
    const targetServerUrl = normalizeServerUrl(params.serverUrl);
    if (!targetServerUrl) return 'blocked';

    const active = getActiveServerSnapshot();
    const scope = params.scope ?? 'device';
    if (canSkipActiveServerUrlSwitch({ activeServerUrl: active.serverUrl, targetServerUrl, scope })) return 'already_active';

    return await runGuardedActiveServerSwitch(async () => {
        const source = params.source ?? 'url';
        if (source === 'manual') {
            const profile = await adoptHomeProfile({
                descriptor: { serverUrl: targetServerUrl },
                source: 'manual',
                preserveUserLabel: true,
            });
            await stageActiveServerAndSwitch(() => {
                setActiveServer({ serverId: profile.id, scope });
            }, params.refreshAuth ?? undefined);
        } else {
            await stageActiveServerAndSwitch(() => {
                upsertAndActivateServer({
                    serverUrl: targetServerUrl,
                    name: params.name ?? defaultServerNameFromUrl(targetServerUrl),
                    source,
                    scope,
                });
            }, params.refreshAuth ?? undefined);
        }
    });
}

export async function setActiveServerAndSwitch(params: Readonly<{
    serverId: string;
    scope?: 'device' | 'tab';
    refreshAuth?: (() => Promise<void>) | null;
}>): Promise<ActiveServerSwitchResult> {
    const targetServerId = String(params.serverId ?? '').trim();
    if (!targetServerId) return 'blocked';

    const active = getActiveServerSnapshot();
    const scope = params.scope ?? 'device';
    if (canSkipActiveServerIdSwitch({ activeServerId: active.serverId, targetServerId, scope })) return 'already_active';

    return await runGuardedActiveServerSwitch(async () => {
        await stageActiveServerAndSwitch(() => {
            setActiveServer({
                serverId: targetServerId,
                scope,
            });
        }, params.refreshAuth ?? undefined);
    });
}

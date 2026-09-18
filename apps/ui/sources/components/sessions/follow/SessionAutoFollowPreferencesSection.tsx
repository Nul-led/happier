import * as React from 'react';
import type { SessionAutoFollowPreferencesV1 } from '@happier-dev/protocol';

import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { sessionAutoFollowPreferencesGet, sessionAutoFollowPreferencesSet } from '@/sync/api/session/sessionFollowApi';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { subscribeHomeCredentialMutations } from '@/auth/storage/tokenStorage';
import { subscribeHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';
import {
    isServerReachabilityNetworkAllowed,
    subscribeServerReachabilityNetworkAllowed,
} from '@/sync/runtime/connectivity/serverReachabilitySupervisorPool';
import { t } from '@/text';

const FIELDS = ['assigned', 'direct', 'team', 'group'] as const;

export function SessionAutoFollowPreferencesSection({ serverId }: Readonly<{ serverId: string }>) {
    const enabled = useFeatureEnabled('sessions.following', { scopeKind: 'spawn', serverId });
    const [preferences, setPreferences] = React.useState<SessionAutoFollowPreferencesV1 | null>(null);
    const [draft, setDraft] = React.useState<SessionAutoFollowPreferencesV1 | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState(false);
    const [online, setOnline] = React.useState(isServerReachabilityNetworkAllowed);
    const currentOperation = React.useRef<object | null>(null);
    const savingRef = React.useRef(false);
    const refreshAfterSaveRef = React.useRef(false);

    const refresh = React.useCallback(async () => {
        if (!enabled || !isServerReachabilityNetworkAllowed()) return;
        if (savingRef.current) {
            // AccountChange is only a content-free invalidation. Coalesce wakes while the
            // mutation owns this lifetime, then reconstruct the authoritative Home state
            // after settlement (the same serialization used by the Follow editor).
            refreshAfterSaveRef.current = true;
            return;
        }
        const operation = {};
        currentOperation.current = operation;
        const result = await sessionAutoFollowPreferencesGet(serverId);
        if (currentOperation.current !== operation) return;
        if (result.kind === 'ok') {
            setPreferences(result.value);
            setDraft(null);
            setError(false);
        } else {
            setError(true);
        }
    }, [enabled, serverId]);

    React.useEffect(() => {
        if (!enabled) return;
        let retired = false;
        const retire = () => {
            retired = true;
            currentOperation.current = null;
            setPreferences(null);
            setDraft(null);
            setSaving(false);
            savingRef.current = false;
            refreshAfterSaveRef.current = false;
        };
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (!lifetime?.isCurrent()) return;
        const retirement = lifetime.onRetire(retire);
        const credentials = subscribeHomeCredentialMutations((event) => {
            if (areServerProfileIdentifiersEquivalent(event.serverId, serverId)) retire();
        });
        // The reachability subscription replays its current value synchronously on
        // subscribe. The mount read below owns the initial load, so only a genuine
        // offline → online transition reconciles here; otherwise every mount issued
        // two authoritative reads.
        let networkAllowed: boolean | null = null;
        const connection = subscribeServerReachabilityNetworkAllowed((next) => {
            if (retired) return;
            setOnline(next);
            const wasAllowed = networkAllowed;
            networkAllowed = next;
            if (next && wasAllowed === false) void refresh();
        });
        const changes = subscribeHomeAccountChange((event) => {
            if (!retired && areServerProfileIdentifiersEquivalent(event.serverId, serverId)) void refresh();
        });
        // Load the current Account preference as soon as the settings section mounts.
        // Without this initial read, the section remains in its loading placeholder until
        // a reconnect or account-change event happens to trigger refresh().
        void refresh();
        return () => {
            // One retirement owner for this section lifetime: a teardown that reset only
            // part of it left the mutation gate closed, so a later lifetime (the feature
            // decision returning after a transient absence) deferred every refresh forever.
            retire();
            retirement.dispose();
            credentials();
            connection();
            changes();
        };
    }, [enabled, refresh, serverId]);

    async function save(next: SessionAutoFollowPreferencesV1) {
        if (!online || savingRef.current || !preferences) return;
        const operation = {};
        currentOperation.current = operation;
        savingRef.current = true;
        setSaving(true);
        setDraft(next);
        setError(false);
        try {
            const result = await sessionAutoFollowPreferencesSet(serverId, next);
            if (currentOperation.current !== operation) return;
            if (result.kind === 'ok') {
                setPreferences(result.value);
                setDraft(null);
            } else {
                setError(true);
            }
        } catch {
            if (currentOperation.current === operation) setError(true);
        } finally {
            if (currentOperation.current !== operation) return;
            savingRef.current = false;
            setSaving(false);
            if (refreshAfterSaveRef.current) {
                refreshAfterSaveRef.current = false;
                await refresh();
            }
        }
    }

    if (!enabled) return null;
    const displayed = draft ?? preferences;
    return <ItemGroup title={t('session.follow.preferences.title')} footer={t('session.follow.preferences.help')}>
        {displayed ? FIELDS.map((field) => <Item
            key={field}
            title={t(`session.follow.preferences.${field}`)}
            titleLines={0}
            showChevron={false}
            rightElement={<Switch
                testID={`session-auto-follow-${field}`}
                value={displayed[field]}
                disabled={!online || saving}
                onValueChange={(value) => { void save({ ...displayed, [field]: value }); }}
            />}
        />) : <Item title={t('common.loading')} loading={!error && online} mode="info" />}
        {!online || error ? <Item
            testID="session-auto-follow-error"
            title={!online ? t('session.follow.offline') : t('errors.unknownError')}
            titleLines={0}
            mode="info"
            accessibilityLiveRegion="polite"
        /> : null}
        {online && error ? <Item
            testID="session-auto-follow-retry"
            title={t('common.retry')}
            onPress={() => { if (draft) void save(draft); else void refresh(); }}
            showChevron={false}
        /> : null}
    </ItemGroup>;
}

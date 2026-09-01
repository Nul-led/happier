import * as React from 'react';
import { ScrollView, View } from 'react-native';
import type {
    ReadWorkspaceSyncFileResultV1,
    WorkspaceSyncConflictV1,
    WorkspaceSyncPersistentModeV1,
} from '@happier-dev/protocol';
import { WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES } from '@happier-dev/protocol';

import { DiffViewer } from '@/components/ui/code/diff/DiffViewer';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import { t } from '@/text';
import {
    deleteWorkspaceSyncConflictLoser,
    readWorkspaceSyncFile,
} from '@/sync/ops/workspaceSync';
import {
    getWorkspaceSyncConflictSnapshot,
    refreshWorkspaceSyncConflicts,
    subscribeWorkspaceSyncConflicts,
} from '@/sync/domains/sessionHandoff/workspaceSyncConflictStore';
import {
    getWorkspaceSyncStatusSnapshot,
    setWorkspaceSyncStatus,
    refreshWorkspaceSyncStatus,
    subscribeWorkspaceSyncStatus,
    type WorkspaceSyncStatusScope,
} from '@/sync/domains/sessionHandoff/workspaceSyncStatusStore';
import {
    formatWorkspaceSyncRelationshipTitle,
    resolveWorkspaceSyncErrorTranslationKey,
    resolveWorkspaceSyncModeTranslationKey,
    resolveWorkspaceSyncStateTranslationKey,
} from '@/sync/domains/sessionHandoff/workspaceSyncPresentation';
import { formatWithCachedDateTimeFormatter } from '@/utils/datetime/cachedIntlFormatters';

export type WorkspaceSyncConflictDetailsResource = Readonly<{
    kind: 'workspaceSyncConflicts';
    relationshipId: string;
    controllerMachineId: string;
    serverId?: string | null;
    mode: WorkspaceSyncPersistentModeV1;
    enabled: boolean;
    alpha: WorkspaceSyncConflictEndpointIdentity;
    beta: WorkspaceSyncConflictEndpointIdentity;
    localSide?: 'alpha' | 'beta' | null;
}>;

export type WorkspaceSyncConflictEndpointIdentity = Readonly<{
    label: string;
    machineId: string | null;
    machineName: string | null;
    rootPath: string | null;
}>;

function isEndpointIdentity(value: unknown): value is WorkspaceSyncConflictEndpointIdentity {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const endpoint = value as Partial<Record<keyof WorkspaceSyncConflictEndpointIdentity, unknown>>;
    return typeof endpoint.label === 'string'
        && (endpoint.machineId === null || typeof endpoint.machineId === 'string')
        && (endpoint.machineName === null || typeof endpoint.machineName === 'string')
        && (endpoint.rootPath === null || typeof endpoint.rootPath === 'string');
}

export function readWorkspaceSyncConflictDetailsResource(value: unknown): WorkspaceSyncConflictDetailsResource | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const resource = value as Partial<Record<keyof WorkspaceSyncConflictDetailsResource, unknown>>;
    if (
        resource.kind !== 'workspaceSyncConflicts'
        || typeof resource.relationshipId !== 'string'
        || typeof resource.controllerMachineId !== 'string'
        || (resource.mode !== 'keep_synced' && resource.mode !== 'mirror_exactly' && resource.mode !== 'keep_both_in_sync')
        || typeof resource.enabled !== 'boolean'
        || !isEndpointIdentity(resource.alpha)
        || !isEndpointIdentity(resource.beta)
        || (resource.localSide != null && resource.localSide !== 'alpha' && resource.localSide !== 'beta')
        || (resource.serverId != null && typeof resource.serverId !== 'string')
    ) return null;
    return resource as WorkspaceSyncConflictDetailsResource;
}

function readErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
}

function fileStateLabel(result: ReadWorkspaceSyncFileResultV1): string {
    switch (result.status) {
        case 'text': return t('workspaceSync.fileState.text');
        case 'binary': return t('workspaceSync.fileState.binary');
        case 'too_large': return t('workspaceSync.fileState.tooLarge');
        case 'missing': return t('workspaceSync.fileState.missing');
        case 'changed': return t('workspaceSync.fileState.changed');
    }
}

function PreviewResult(props: Readonly<{
    path: string;
    alpha: ReadWorkspaceSyncFileResultV1;
    beta: ReadWorkspaceSyncFileResultV1;
    alphaIdentity: WorkspaceSyncConflictEndpointIdentity;
    betaIdentity: WorkspaceSyncConflictEndpointIdentity;
}>) {
    const identities = (
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
            <EndpointIdentity identity={props.alphaIdentity} />
            <EndpointIdentity identity={props.betaIdentity} />
        </View>
    );
    if (props.alpha.status === 'text' && props.beta.status === 'text') {
        return (
            <>
                {identities}
                <DiffViewer
                    mode="text"
                    filePath={props.path}
                    oldText={props.alpha.text}
                    newText={props.beta.text}
                    showLineNumbers={true}
                />
            </>
        );
    }
    return (
        <View style={{ padding: 16, gap: 8 }}>
            <EndpointIdentity identity={props.alphaIdentity} />
            <Text>{fileStateLabel(props.alpha)}</Text>
            <EndpointIdentity identity={props.betaIdentity} />
            <Text>{fileStateLabel(props.beta)}</Text>
        </View>
    );
}

function EndpointIdentity(props: Readonly<{ identity: WorkspaceSyncConflictEndpointIdentity }>) {
    const detail = [props.identity.machineName, props.identity.rootPath].filter(Boolean).join(' · ');
    return (
        <View>
            <Text>{props.identity.label}</Text>
            {detail ? <Text style={{ opacity: 0.75 }}>{detail}</Text> : null}
        </View>
    );
}

function canDeleteConflictEndpoint(
    endpoint: WorkspaceSyncConflictV1['alpha'] | WorkspaceSyncConflictV1['beta'],
): boolean {
    return endpoint.kind !== 'file' || typeof endpoint.digest === 'string';
}

export const WorkspaceSyncConflictDetailsView = React.memo(function WorkspaceSyncConflictDetailsView(props: Readonly<{
    resource: WorkspaceSyncConflictDetailsResource;
}>) {
    const scope = React.useMemo<WorkspaceSyncStatusScope>(() => ({
        relationshipId: props.resource.relationshipId,
        controllerMachineId: props.resource.controllerMachineId,
        serverId: props.resource.serverId,
    }), [props.resource.controllerMachineId, props.resource.relationshipId, props.resource.serverId]);
    const [, rerender] = React.useReducer((value: number) => value + 1, 0);
    const [selected, setSelected] = React.useState<WorkspaceSyncConflictV1 | null>(null);
    const [preview, setPreview] = React.useState<Readonly<{
        alpha: ReadWorkspaceSyncFileResultV1;
        beta: ReadWorkspaceSyncFileResultV1;
    }> | null>(null);
    const [previewLoading, setPreviewLoading] = React.useState(false);
    const [previewUnavailable, setPreviewUnavailable] = React.useState(false);
    const [resolvingSide, setResolvingSide] = React.useState<'alpha' | 'beta' | null>(null);
    const [resolutionError, setResolutionError] = React.useState<'changed' | 'failed' | null>(null);
    const snapshot = getWorkspaceSyncConflictSnapshot(scope);
    const statusSnapshot = getWorkspaceSyncStatusSnapshot(scope);
    const status = statusSnapshot.status;
    const alphaIdentity = status?.alphaPath
        ? { ...props.resource.alpha, rootPath: status.alphaPath }
        : props.resource.alpha;
    const betaIdentity = status?.betaPath
        ? { ...props.resource.beta, rootPath: status.betaPath }
        : props.resource.beta;
    const localSide = props.resource.localSide ?? null;
    const remoteSide = localSide === 'alpha' ? 'beta' : localSide === 'beta' ? 'alpha' : null;
    const localActionTitle = localSide
        ? t('workspaceSync.actions.keepLocal')
        : t('workspaceSync.actions.keepNamed', { side: props.resource.alpha.label });
    const remoteActionTitle = remoteSide
        ? t('workspaceSync.actions.keepRemote')
        : t('workspaceSync.actions.keepNamed', { side: props.resource.beta.label });

    React.useEffect(() => {
        const unsubscribe = subscribeWorkspaceSyncConflicts(scope, rerender);
        if (getWorkspaceSyncConflictSnapshot(scope).phase === 'idle') {
            void refreshWorkspaceSyncConflicts(scope).catch(() => undefined);
        }
        return unsubscribe;
    }, [scope]);

    React.useEffect(() => {
        const unsubscribe = subscribeWorkspaceSyncStatus(scope, rerender);
        if (getWorkspaceSyncStatusSnapshot(scope).phase === 'idle') {
            void refreshWorkspaceSyncStatus(scope).catch(() => undefined);
        }
        return unsubscribe;
    }, [scope]);

    React.useEffect(() => {
        if (!selected) {
            setPreview(null);
            setResolutionError(null);
            return;
        }
        let active = true;
        setPreviewLoading(true);
        setPreviewUnavailable(false);
        Promise.all([
            readWorkspaceSyncFile({
                ...scope,
                request: {
                    relationshipId: scope.relationshipId,
                    side: 'alpha',
                    path: selected.path,
                    maxBytes: WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES,
                    ...(selected.alpha.digest ? { expectedDigest: selected.alpha.digest } : {}),
                },
            }),
            readWorkspaceSyncFile({
                ...scope,
                request: {
                    relationshipId: scope.relationshipId,
                    side: 'beta',
                    path: selected.path,
                    maxBytes: WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES,
                    ...(selected.beta.digest ? { expectedDigest: selected.beta.digest } : {}),
                },
            }),
        ]).then(([alpha, beta]) => {
            if (active) setPreview({ alpha, beta });
        }, () => {
            if (active) {
                setPreview(null);
                setPreviewUnavailable(true);
            }
        }).finally(() => {
            if (active) setPreviewLoading(false);
        });
        return () => { active = false; };
    }, [scope, selected]);

    const keepSide = React.useCallback(async (keep: 'alpha' | 'beta') => {
        if (!selected || resolvingSide) return;
        const losingEndpoint = keep === 'alpha' ? selected.beta : selected.alpha;
        if (losingEndpoint.kind === 'directory') {
            const keptIdentity = keep === 'alpha' ? props.resource.alpha : props.resource.beta;
            const confirmed = await Modal.confirm(
                t('workspaceSync.resolve.title'),
                t('workspaceSync.resolve.body', { path: selected.path, side: keptIdentity.label }),
                {
                    confirmText: keep === localSide
                        ? localActionTitle
                        : keep === remoteSide
                            ? remoteActionTitle
                            : t('workspaceSync.actions.keepNamed', { side: keptIdentity.label }),
                    cancelText: t('common.cancel'),
                },
            );
            if (!confirmed) return;
        }
        setResolutionError(null);
        setResolvingSide(keep);
        try {
            const status = await deleteWorkspaceSyncConflictLoser({
                ...scope,
                request: {
                    relationshipId: scope.relationshipId,
                    path: selected.path,
                    keep,
                    expectedKind: losingEndpoint.kind,
                    ...(losingEndpoint.digest ? { expectedDigest: losingEndpoint.digest } : {}),
                },
            });
            setWorkspaceSyncStatus(scope, status);
            setSelected(null);
            await refreshWorkspaceSyncConflicts(scope);
        } catch (error: unknown) {
            if (readErrorCode(error) === 'conflict_changed') {
                const [latest] = await Promise.all([
                    refreshWorkspaceSyncConflicts(scope).catch(() => null),
                    refreshWorkspaceSyncStatus(scope).catch(() => undefined),
                ]);
                if (latest) {
                    const refreshedConflict = latest.conflicts.find((conflict) => conflict.path === selected.path) ?? null;
                    setSelected(refreshedConflict);
                    if (refreshedConflict) setResolutionError('changed');
                } else {
                    setResolutionError('failed');
                }
                return;
            }
            setResolutionError('failed');
        } finally {
            setResolvingSide(null);
        }
    }, [localActionTitle, localSide, props.resource.alpha, props.resource.beta, remoteActionTitle, remoteSide, resolvingSide, scope, selected]);

    if (selected) {
        const canKeepAlpha = canDeleteConflictEndpoint(selected.beta);
        const canKeepBeta = canDeleteConflictEndpoint(selected.alpha);
        return (
            <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
                    <IconButton iconName="arrow-left" accessibilityLabel={t('common.back')} onPress={() => setSelected(null)} />
                    <Text numberOfLines={1} style={{ flex: 1 }}>{selected.path}</Text>
                </View>
                <ScrollView style={{ flex: 1 }}>
                    {previewLoading ? <Text style={{ padding: 16 }}>{t('common.loading')}</Text> : null}
                    {previewUnavailable ? <Text style={{ padding: 16 }}>{t('workspaceSync.previewUnavailable')}</Text> : null}
                    {preview ? (
                        <PreviewResult
                            path={selected.path}
                            alpha={preview.alpha}
                            beta={preview.beta}
                            alphaIdentity={alphaIdentity}
                            betaIdentity={betaIdentity}
                        />
                    ) : null}
                    <View style={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}>
                        <Text style={{ opacity: 0.75 }}>{t('workspaceSync.resolve.consequence')}</Text>
                        {resolutionError ? (
                            <Text accessibilityLiveRegion="polite">
                                {resolutionError === 'changed' ? t('workspaceSync.resolve.changedBody') : t('errors.operationFailed')}
                            </Text>
                        ) : null}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {((localSide ?? 'alpha') === 'alpha' ? canKeepAlpha : canKeepBeta) ? (
                                <RoundButton
                                    size="normal"
                                    title={localActionTitle}
                                    accessibilityLabel={localActionTitle}
                                    accessibilityHint={t('workspaceSync.resolve.keepHint', { side: localSide === 'beta' ? props.resource.beta.label : props.resource.alpha.label })}
                                    loading={resolvingSide === (localSide ?? 'alpha')}
                                    disabled={resolvingSide !== null}
                                    onPress={() => void keepSide(localSide ?? 'alpha')}
                                />
                            ) : null}
                            {((remoteSide ?? 'beta') === 'alpha' ? canKeepAlpha : canKeepBeta) ? (
                                <RoundButton
                                    size="normal"
                                    display="inverted"
                                    title={remoteActionTitle}
                                    accessibilityLabel={remoteActionTitle}
                                    accessibilityHint={t('workspaceSync.resolve.keepHint', { side: remoteSide === 'alpha' ? props.resource.alpha.label : props.resource.beta.label })}
                                    loading={resolvingSide === (remoteSide ?? 'beta')}
                                    disabled={resolvingSide !== null}
                                    onPress={() => void keepSide(remoteSide ?? 'beta')}
                                />
                            ) : null}
                        </View>
                        {!canKeepAlpha || !canKeepBeta ? (
                            <Text accessibilityLiveRegion="polite">{t('workspaceSync.resolve.unverifiedFile')}</Text>
                        ) : null}
                    </View>
                </ScrollView>
            </View>
        );
    }

    const modeKey = resolveWorkspaceSyncModeTranslationKey(props.resource.mode);
    const stateKey = status ? resolveWorkspaceSyncStateTranslationKey(status.state) : null;
    const errorKey = resolveWorkspaceSyncErrorTranslationKey(status?.errorCode);
    const stateLabel = !props.resource.enabled
        ? t('workspaceSync.state.stopped')
        : status?.errorCode === 'engine_unavailable'
            ? t('workspaceSync.state.engineUnavailable')
            : statusSnapshot.phase === 'error'
                ? t('workspaceSync.state.controllerUnavailable')
                : stateKey
                    ? t(stateKey)
                    : t('workspaceSync.state.loading');
    const lastSyncLabel = status?.lastSuccessfulSyncAtMs == null
        ? t('workspaceSync.neverSynced')
        : t('workspaceSync.lastSynced', {
            at: formatWithCachedDateTimeFormatter(status.lastSuccessfulSyncAtMs, undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        });
    const bidirectional = props.resource.mode === 'keep_both_in_sync';
    const relationshipTitle = formatWorkspaceSyncRelationshipTitle({
        alphaLabel: props.resource.alpha.label,
        betaLabel: props.resource.beta.label,
        mode: props.resource.mode,
    });
    const endpointSubtitle = (endpoint: WorkspaceSyncConflictEndpointIdentity) => (
        [endpoint.machineName, endpoint.rootPath].filter(Boolean).join(' · ') || undefined
    );

    return (
        <ItemList containerStyle={{ paddingTop: 12 }}>
            <ItemGroup title={t('workspaceSync.title')}>
                <Item
                    title={relationshipTitle}
                    subtitle={modeKey ? t(modeKey) : t('workspaceSync.unknownMode')}
                    mode="info"
                />
                <Item
                    title={stateLabel}
                    subtitle={[lastSyncLabel, errorKey ? t(errorKey) : null].filter(Boolean).join(' · ')}
                    mode="info"
                />
                <Item
                    title={bidirectional
                        ? t('workspaceSync.endpoint.synced', { label: props.resource.alpha.label })
                        : t('workspaceSync.endpoint.source', { label: props.resource.alpha.label })}
                    subtitle={endpointSubtitle(alphaIdentity)}
                    mode="info"
                />
                <Item
                    title={bidirectional
                        ? t('workspaceSync.endpoint.synced', { label: props.resource.beta.label })
                        : t('workspaceSync.endpoint.destination', { label: props.resource.beta.label })}
                    subtitle={endpointSubtitle(betaIdentity)}
                    mode="info"
                />
            </ItemGroup>
            <ItemGroup title={t('workspaceSync.diagnostics.title')}>
                <Item title={t('workspaceSync.diagnostics.relationshipId')} subtitle={props.resource.relationshipId} subtitleLines={0} copy={props.resource.relationshipId} showChevron={false} />
                <Item title={t('workspaceSync.diagnostics.controllerMachineId')} subtitle={props.resource.controllerMachineId} subtitleLines={0} copy={props.resource.controllerMachineId} showChevron={false} />
                {props.resource.alpha.machineId ? <Item title={t('workspaceSync.diagnostics.alphaMachineId')} subtitle={props.resource.alpha.machineId} subtitleLines={0} copy={props.resource.alpha.machineId} showChevron={false} /> : null}
                {props.resource.beta.machineId ? <Item title={t('workspaceSync.diagnostics.betaMachineId')} subtitle={props.resource.beta.machineId} subtitleLines={0} copy={props.resource.beta.machineId} showChevron={false} /> : null}
                {alphaIdentity.rootPath ? <Item title={t('workspaceSync.diagnostics.alphaRoot')} subtitle={alphaIdentity.rootPath} subtitleLines={0} copy={alphaIdentity.rootPath} showChevron={false} /> : null}
                {betaIdentity.rootPath ? <Item title={t('workspaceSync.diagnostics.betaRoot')} subtitle={betaIdentity.rootPath} subtitleLines={0} copy={betaIdentity.rootPath} showChevron={false} /> : null}
                <Item title={t('workspaceSync.diagnostics.engineMode')} subtitle={status?.mode ?? props.resource.mode} subtitleLines={0} copy={status?.mode ?? props.resource.mode} showChevron={false} />
                {status ? <Item title={t('workspaceSync.diagnostics.engineState')} subtitle={status.state} subtitleLines={0} copy={status.state} showChevron={false} /> : null}
                {status?.errorCode ? <Item title={t('workspaceSync.diagnostics.errorCode')} subtitle={status.errorCode} subtitleLines={0} copy={status.errorCode} showChevron={false} /> : null}
            </ItemGroup>
            <ItemGroup title={t('workspaceSync.conflictsTitle')}>
                {snapshot.phase === 'error' ? <Item title={t('workspaceSync.state.controllerUnavailable')} mode="info" /> : null}
                {snapshot.list?.totalCount === 0 ? <Item title={t('workspaceSync.noConflicts')} mode="info" /> : null}
                {snapshot.list?.conflicts.map((conflict) => (
                    <Item
                        key={conflict.path}
                        title={conflict.path}
                        subtitle={`${props.resource.alpha.label}: ${conflict.alpha.kind} · ${props.resource.beta.label}: ${conflict.beta.kind}`}
                        onPress={() => setSelected(conflict)}
                    />
                ))}
                {snapshot.list && snapshot.list.truncatedCount > 0 ? (
                    <Item title={t('workspaceSync.truncated', { count: snapshot.list.truncatedCount })} mode="info" />
                ) : null}
                {snapshot.phase === 'loading' ? <Item title={t('common.loading')} mode="info" /> : null}
                <Item title={t('workspaceSync.actions.refresh')} onPress={() => void refreshWorkspaceSyncConflicts(scope).catch(() => undefined)} />
            </ItemGroup>
        </ItemList>
    );
});

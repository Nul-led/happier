import * as React from 'react';
import { ScrollView, View } from 'react-native';
import type {
    ReadWorkspaceSyncFileResultV1,
    WorkspaceSyncConflictV1,
} from '@happier-dev/protocol';

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
    setWorkspaceSyncStatus,
    refreshWorkspaceSyncStatus,
    type WorkspaceSyncStatusScope,
} from '@/sync/domains/sessionHandoff/workspaceSyncStatusStore';

export type WorkspaceSyncConflictDetailsResource = Readonly<{
    kind: 'workspaceSyncConflicts';
    relationshipId: string;
    controllerMachineId: string;
    serverId?: string | null;
    alphaLabel: string;
    betaLabel: string;
    localSide?: 'alpha' | 'beta' | null;
}>;

export function readWorkspaceSyncConflictDetailsResource(value: unknown): WorkspaceSyncConflictDetailsResource | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const resource = value as Partial<Record<keyof WorkspaceSyncConflictDetailsResource, unknown>>;
    if (
        resource.kind !== 'workspaceSyncConflicts'
        || typeof resource.relationshipId !== 'string'
        || typeof resource.controllerMachineId !== 'string'
        || typeof resource.alphaLabel !== 'string'
        || typeof resource.betaLabel !== 'string'
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
}>) {
    if (props.alpha.status === 'text' && props.beta.status === 'text') {
        return (
            <DiffViewer
                mode="text"
                filePath={props.path}
                oldText={props.alpha.text}
                newText={props.beta.text}
                showLineNumbers={true}
            />
        );
    }
    return (
        <View style={{ padding: 16, gap: 8 }}>
            <Text>{fileStateLabel(props.alpha)}</Text>
            <Text>{fileStateLabel(props.beta)}</Text>
        </View>
    );
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
    const snapshot = getWorkspaceSyncConflictSnapshot(scope);
    const localSide = props.resource.localSide ?? null;
    const remoteSide = localSide === 'alpha' ? 'beta' : localSide === 'beta' ? 'alpha' : null;
    const localActionTitle = localSide
        ? t('workspaceSync.actions.keepLocal')
        : t('workspaceSync.actions.keepNamed', { side: props.resource.alphaLabel });
    const remoteActionTitle = remoteSide
        ? t('workspaceSync.actions.keepRemote')
        : t('workspaceSync.actions.keepNamed', { side: props.resource.betaLabel });

    React.useEffect(() => {
        const unsubscribe = subscribeWorkspaceSyncConflicts(scope, rerender);
        if (getWorkspaceSyncConflictSnapshot(scope).phase === 'idle') {
            void refreshWorkspaceSyncConflicts(scope).catch(() => undefined);
        }
        return unsubscribe;
    }, [scope]);

    React.useEffect(() => {
        if (!selected) {
            setPreview(null);
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
                    ...(selected.alpha.digest ? { expectedDigest: selected.alpha.digest } : {}),
                },
            }),
            readWorkspaceSyncFile({
                ...scope,
                request: {
                    relationshipId: scope.relationshipId,
                    side: 'beta',
                    path: selected.path,
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
        const confirmed = await Modal.confirm(
            t('workspaceSync.resolve.title'),
            t('workspaceSync.resolve.body', { path: selected.path, side: keep === 'alpha' ? props.resource.alphaLabel : props.resource.betaLabel }),
            { confirmText: keep === localSide ? localActionTitle : keep === remoteSide ? remoteActionTitle : t('workspaceSync.actions.keepNamed', { side: keep === 'alpha' ? props.resource.alphaLabel : props.resource.betaLabel }), cancelText: t('common.cancel') },
        );
        if (!confirmed) return;
        const losingEndpoint = keep === 'alpha' ? selected.beta : selected.alpha;
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
                Modal.alert(t('workspaceSync.resolve.changedTitle'), t('workspaceSync.resolve.changedBody'));
                await Promise.all([
                    refreshWorkspaceSyncConflicts(scope).catch(() => undefined),
                    refreshWorkspaceSyncStatus(scope).catch(() => undefined),
                ]);
                return;
            }
            Modal.alert(t('common.error'), t('errors.operationFailed'));
        } finally {
            setResolvingSide(null);
        }
    }, [localActionTitle, localSide, props.resource.alphaLabel, props.resource.betaLabel, remoteActionTitle, remoteSide, resolvingSide, scope, selected]);

    if (selected) {
        return (
            <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
                    <IconButton iconName="arrow-left" accessibilityLabel={t('common.back')} onPress={() => setSelected(null)} />
                    <Text numberOfLines={1} style={{ flex: 1 }}>{selected.path}</Text>
                </View>
                <ScrollView style={{ flex: 1 }}>
                    {previewLoading ? <Text style={{ padding: 16 }}>{t('common.loading')}</Text> : null}
                    {previewUnavailable ? <Text style={{ padding: 16 }}>{t('workspaceSync.previewUnavailable')}</Text> : null}
                    {preview ? <PreviewResult path={selected.path} alpha={preview.alpha} beta={preview.beta} /> : null}
                    <View style={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}>
                        <Text style={{ opacity: 0.75 }}>{t('workspaceSync.resolve.consequence')}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            <RoundButton
                                size="normal"
                                title={localActionTitle}
                                accessibilityLabel={localActionTitle}
                                accessibilityHint={t('workspaceSync.resolve.keepHint', { side: localSide === 'beta' ? props.resource.betaLabel : props.resource.alphaLabel })}
                                loading={resolvingSide === (localSide ?? 'alpha')}
                                disabled={resolvingSide !== null}
                                onPress={() => void keepSide(localSide ?? 'alpha')}
                            />
                            <RoundButton
                                size="normal"
                                display="inverted"
                                title={remoteActionTitle}
                                accessibilityLabel={remoteActionTitle}
                                accessibilityHint={t('workspaceSync.resolve.keepHint', { side: remoteSide === 'alpha' ? props.resource.alphaLabel : props.resource.betaLabel })}
                                loading={resolvingSide === (remoteSide ?? 'beta')}
                                disabled={resolvingSide !== null}
                                onPress={() => void keepSide(remoteSide ?? 'beta')}
                            />
                        </View>
                    </View>
                </ScrollView>
            </View>
        );
    }

    return (
        <ItemList containerStyle={{ paddingTop: 12 }}>
            <ItemGroup title={t('workspaceSync.conflictsTitle')}>
                {snapshot.phase === 'error' ? <Item title={t('workspaceSync.state.controllerUnavailable')} mode="info" /> : null}
                {snapshot.list?.totalCount === 0 ? <Item title={t('workspaceSync.noConflicts')} mode="info" /> : null}
                {snapshot.list?.conflicts.map((conflict) => (
                    <Item key={conflict.path} title={conflict.path} subtitle={`${conflict.alpha.kind} ↔ ${conflict.beta.kind}`} onPress={() => setSelected(conflict)} />
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

import React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { InlineAddExpander } from '@/components/ui/forms/InlineAddExpander';
import type { SavedSecret } from '@/sync/domains/settings/savedSecretTypes';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import type { SavedSecretCatalogCorruptEntryV1, SavedSecretCatalogEntryV1 } from '@happier-dev/protocol';
import type { SavedSecretReferenceResolution } from '@/sync/store/settings/savedSecretCatalogSnapshot';


export interface SecretsListProps {
    secrets: readonly SavedSecret[];
    onCreatePersonal?: (input: Readonly<{ name: string; value: string }>) => Promise<string | null>;
    onRenamePersonal?: (secret: SavedSecret) => Promise<boolean>;
    onRotatePersonal?: (secret: SavedSecret) => Promise<boolean>;
    onDeletePersonal?: (secret: SavedSecret) => Promise<boolean>;

    title?: string;
    footer?: string | null;

    selectedId?: string;
    onSelectId?: (id: string) => void;

    includeNoneRow?: boolean;
    noneSubtitle?: string;

    defaultId?: string | null;
    onSetDefaultId?: (id: string | null) => void;

    allowAdd?: boolean;
    allowEdit?: boolean;
    onAfterAddSelectId?: (id: string) => void;
    onSharePersonal?: (secret: SavedSecret) => void;
    sharingPersonalId?: string | null;
    onCreateShared?: () => void;

    /** Shared-resource rows from the canonical Account-scoped catalog. */
    sharedEntries?: readonly SavedSecretCatalogEntryV1[];
    /** Settings-only repair projection. Picker callers deliberately omit it. */
    corruptEntries?: readonly SavedSecretCatalogCorruptEntryV1[];
    onDeleteCorruptShared?: (entry: Extract<SavedSecretCatalogCorruptEntryV1, { relationship: 'owner' }>) => void;
    resolveSharedReference?: (ref: string) => SavedSecretReferenceResolution;
    onRenameShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onRotateShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onManageAccessShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onDeleteShared?: (entry: SavedSecretCatalogEntryV1) => void;
    sharedMutationsDisabled?: boolean;
    sharedApprovalId?: string | null;
    onOpenSharedApproval?: () => void;
    allowSharedSelection?: boolean;
    sharedCatalogStale?: boolean;
    onRetrySharedCatalog?: () => void;

    wrapInItemList?: boolean;
}

function sharedSecretStatusLabel(status: SavedSecretCatalogEntryV1['materialStatus']): string {
    switch (status) {
        case 'ready': return t('secrets.catalog.status.ready');
        case 'preparing_encrypted_access': return t('secrets.catalog.status.preparing_encrypted_access');
        case 'recipient_mode_unsupported': return t('secrets.catalog.status.recipient_mode_unsupported');
        case 'temporarily_unavailable': return t('secrets.catalog.status.temporarily_unavailable');
        case 'access_removed': return t('secrets.catalog.status.access_removed');
        case 'deleted': return t('secrets.catalog.status.deleted');
        case 'update_required': return t('secrets.catalog.status.update_required');
    }
}

/**
 * Where a shared secret came from, in the words the Home already projected.
 *
 * Picking a shared secret decides whose credential a Session spends, so the row
 * states the recipient-safe owner and the access that carries it. Both facts are
 * read straight from the catalog projection — nothing is inferred from the
 * focused Home, the Team the surface happens to sit in, or the secret's name —
 * and an owner row states neither, because it is the person's own secret.
 */
function sharedSecretProvenanceSegments(entry: SavedSecretCatalogEntryV1): readonly string[] {
    const ownerName = entry.owner ? formatAccountDisplayName(entry.owner) : null;
    return [
        ...(entry.relationship === 'recipient' && ownerName
            ? [t('secrets.catalog.provenance.sharedBy', { owner: ownerName })]
            : []),
        ...entry.accessSources.map((source) => {
            if (source.kind === 'account') return t('secrets.catalog.provenance.direct');
            return t('secrets.catalog.provenance.via', {
                source: source.kind === 'group' ? `${source.teamName} · ${source.name}` : source.name,
            });
        }),
    ];
}

export function SecretsList(props: SecretsListProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const {
        secrets,
        defaultId,
        onAfterAddSelectId,
        selectedId,
        onSelectId,
        onSetDefaultId,
        onCreatePersonal,
        onRenamePersonal,
        onRotatePersonal,
        onDeletePersonal,
    } = props;

    const orderedSecrets = React.useMemo(() => {
        const resolvedDefaultId = defaultId ?? null;
        if (!resolvedDefaultId) return secrets;
        const defaultSecret = secrets.find((k) => k.id === resolvedDefaultId) ?? null;
        if (!defaultSecret) return secrets;
        const rest = secrets.filter((k) => k.id !== resolvedDefaultId);
        return [defaultSecret, ...rest];
    }, [defaultId, secrets]);

    const [isAddExpanded, setIsAddExpanded] = React.useState(false);
    const [draftName, setDraftName] = React.useState('');
    const [draftValue, setDraftValue] = React.useState('');
    const nameInputRef = React.useRef<React.ElementRef<typeof TextInput> | null>(null);

    const resetAddDraft = React.useCallback(() => {
        setDraftName('');
        setDraftValue('');
        setIsAddExpanded(false);
    }, []);

    const submitAddSecret = React.useCallback(async () => {
        const name = draftName.trim();
        const value = draftValue;
        if (!name) return;
        if (value.length === 0) return;
        const createdId = await onCreatePersonal?.({ name, value });
        if (!createdId) return;
        onAfterAddSelectId?.(createdId);
        resetAddDraft();
    }, [draftName, draftValue, onAfterAddSelectId, onCreatePersonal, resetAddDraft]);

    const deleteSecret = React.useCallback(async (secret: SavedSecret) => {
        if (!await onDeletePersonal?.(secret)) return;
        if (selectedId === secret.id) {
            onSelectId?.('');
        }
        if (defaultId === secret.id) {
            onSetDefaultId?.(null);
        }
    }, [defaultId, onDeletePersonal, onSelectId, onSetDefaultId, selectedId]);

    const groupTitle = props.title ?? ((props.sharedEntries?.length ?? 0) + (props.corruptEntries?.length ?? 0) > 0
        ? t('secrets.catalog.relationship.owner')
        : t('settings.secrets'));
    const groupFooter = props.footer === undefined ? t('settings.secretsSubtitle') : (props.footer ?? undefined);
    const ownerSharedEntries = (props.sharedEntries ?? []).filter((entry) => entry.relationship === 'owner');
    const recipientSharedEntries = (props.sharedEntries ?? []).filter((entry) => entry.relationship === 'recipient');
    const ownerCorruptEntries = (props.corruptEntries ?? []).filter(
        (entry): entry is Extract<SavedSecretCatalogCorruptEntryV1, { relationship: 'owner' }> => entry.relationship === 'owner',
    );
    const recipientCorruptEntries = (props.corruptEntries ?? []).filter((entry) => entry.relationship === 'recipient');

    const renderCorruptEntry = (entry: SavedSecretCatalogCorruptEntryV1, idx: number, total: number) => {
        const ownerEntry = entry.relationship === 'owner' ? entry : null;
        const ownerCanDelete = ownerEntry !== null && Boolean(props.onDeleteCorruptShared);
        return (
            <Item
                key={ownerEntry ? `owner:${ownerEntry.repair.resourceId}` : `recipient:${idx}`}
                testID={`saved-secret-corrupt:${entry.relationship}:${idx}`}
                title={t('secrets.catalog.unavailableName')}
                subtitle={t('secrets.catalog.status.resource_corrupt')}
                accessibilityLabel={[
                    t('secrets.catalog.unavailableName'),
                    entry.relationship === 'owner'
                        ? t('secrets.catalog.relationship.owner')
                        : t('secrets.catalog.relationship.recipient'),
                    t('secrets.catalog.status.resource_corrupt'),
                ].join(', ')}
                icon={<Icon name="warning-circle" size={29} color={theme.colors.state.warning.foreground} />}
                showChevron={false}
                showDivider={idx < total - 1}
                mode="info"
                rightElementOutsidePressable={ownerCanDelete}
                rightElement={ownerCanDelete ? (
                    <ItemRowActions
                        title={t('secrets.catalog.unavailableName')}
                        overflowTriggerTestID={`saved-secret-corrupt:owner:${idx}:more`}
                        actions={[{
                            id: 'delete',
                            inlineTestID: `saved-secret-corrupt:owner:${idx}:delete`,
                            title: t('common.delete'),
                            icon: 'trash',
                            destructive: true,
                            disabled: props.sharedMutationsDisabled,
                            onPress: () => { if (ownerEntry) props.onDeleteCorruptShared?.(ownerEntry); },
                        }]}
                    />
                ) : undefined}
            />
        );
    };

    const renderSharedEntry = (entry: SavedSecretCatalogEntryV1, idx: number, total: number) => {
        const resolvedStatus = props.resolveSharedReference?.(entry.ref).status ?? entry.materialStatus;
        const provenance = sharedSecretProvenanceSegments(entry);
        const ready = props.allowSharedSelection !== false
            && resolvedStatus === 'ready'
            && entry.capabilities.use;
        const actions = [
            entry.capabilities.rename && props.onRenameShared ? {
                id: 'rename', title: t('common.rename'), icon: 'pencil' as const,
                disabled: props.sharedMutationsDisabled,
                onPress: () => props.onRenameShared?.(entry),
            } : null,
            entry.capabilities.rotate && props.onRotateShared ? {
                id: 'rotate', title: t('secrets.actions.replaceValue'), icon: 'arrow-clockwise' as const,
                disabled: props.sharedMutationsDisabled,
                onPress: () => props.onRotateShared?.(entry),
            } : null,
            entry.capabilities.manageAccess && props.onManageAccessShared ? {
                id: 'manageAccess', title: t('secrets.catalog.actions.manageAccess'), icon: 'users' as const,
                disabled: props.sharedMutationsDisabled,
                onPress: () => props.onManageAccessShared?.(entry),
            } : null,
            entry.capabilities.delete && props.onDeleteShared ? {
                id: 'delete', title: t('common.delete'), icon: 'trash' as const, destructive: true,
                disabled: props.sharedMutationsDisabled,
                onPress: () => props.onDeleteShared?.(entry),
            } : null,
        ].filter((action): action is NonNullable<typeof action> => action !== null);
        return (
            <Item
                key={entry.ref}
                testID={`saved-secret:${entry.ref}`}
                title={entry.name ?? t('secrets.catalog.unavailableName')}
                subtitle={[...provenance, sharedSecretStatusLabel(resolvedStatus)].join(' · ')}
                accessibilityLabel={[
                    entry.name ?? t('secrets.catalog.unavailableName'),
                    entry.relationship === 'owner'
                        ? t('secrets.catalog.relationship.owner')
                        : t('secrets.catalog.relationship.recipient'),
                    ...provenance,
                    sharedSecretStatusLabel(resolvedStatus),
                ].join(', ')}
                icon={<Icon name="key" size={29} color={theme.colors.button.secondary.tint} />}
                onPress={props.onSelectId && ready ? () => props.onSelectId?.(entry.ref) : undefined}
                showChevron={false}
                selected={Boolean(props.onSelectId) && props.selectedId === entry.ref}
                showDivider={idx < total - 1}
                disabled={Boolean(props.onSelectId) && !ready}
                rightElementOutsidePressable={actions.length > 0}
                rightElement={actions.length > 0 ? (
                    <ItemRowActions
                        title={entry.name ?? t('secrets.catalog.unavailableName')}
                        overflowTriggerTestID={`saved-secret:${entry.ref}:more`}
                        compactActionIds={['manageAccess']}
                        actions={actions}
                    />
                ) : undefined}
            />
        );
    };

    const group = (
        <>
            {props.sharedApprovalId && props.onOpenSharedApproval ? (
                <ItemGroup>
                    <Item
                        testID="saved-secret-approval"
                        title={t('approvals.title')}
                        subtitle={t('secrets.catalog.approvalPending')}
                        accessibilityLiveRegion="polite"
                        onPress={props.onOpenSharedApproval}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            <ItemGroup title={groupTitle}>
                {props.sharedCatalogStale && props.onRetrySharedCatalog ? (
                    <Item
                        testID="saved-secret-catalog-retry"
                        title={t('common.retry')}
                        subtitle={t('secrets.catalog.operationFailed')}
                        onPress={props.onRetrySharedCatalog}
                        showChevron={false}
                    />
                ) : null}
                {props.includeNoneRow && (
                    <Item
                        testID="saved-secret:none"
                        title={t('secrets.noneTitle')}
                        subtitle={props.noneSubtitle ?? t('secrets.noneSubtitle')}
                        icon={<Icon name="x-circle" size={29} color={theme.colors.text.secondary} />}
                        onPress={() => props.onSelectId?.('')}
                        showChevron={false}
                        selected={props.selectedId === ''}
                        showDivider
                    />
                )}

                {props.secrets.length === 0 && (props.sharedEntries?.length ?? 0) === 0 && (props.corruptEntries?.length ?? 0) === 0 ? (
                    <Item
                        testID="saved-secret:empty"
                        title={t('secrets.emptyTitle')}
                        subtitle={t('secrets.emptySubtitle')}
                        icon={<Icon name="key" size={29} color={theme.colors.text.secondary} />}
                        showChevron={false}
                    />
                ) : (
                    <>
                    {orderedSecrets.map((secret, idx) => {
                        const isSelected = props.selectedId === secret.id;
                        const isDefault = props.defaultId === secret.id;
                        return (
                            <Item
                                key={secret.id}
                                testID={`saved-secret:${secret.id}`}
                                title={secret.name}
                                subtitle={t('secrets.savedHiddenSubtitle')}
                                icon={<Icon name="key" size={29} color={theme.colors.button.secondary.tint} />}
                                onPress={props.onSelectId ? () => props.onSelectId?.(secret.id) : undefined}
                                showChevron={false}
                                selected={Boolean(props.onSelectId) ? isSelected : false}
                                showDivider={idx < orderedSecrets.length - 1 || (props.sharedEntries?.length ?? 0) > 0}
                                // The accessory owns its own buttons (rename/replace/delete,
                                // set-default), so it must sit beside the row's activation
                                // owner rather than inside it. Without this the row stops
                                // being a button on web — `Item` drops the role to keep the
                                // markup valid — losing its accessible name and keyboard
                                // activation on every surface that embeds this list.
                                rightElementOutsidePressable
                                rightElement={(
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                        {props.onSetDefaultId && (
                                            <ItemRowActions
                                                title={t('secrets.defaultLabel')}
                                                overflowTriggerTestID={`saved-secret:${secret.id}:default-more`}
                                                compactActionIds={['default']}
                                                iconSize={18}
                                                actions={[
                                                    {
                                                        id: 'default',
                                                        inlineTestID: `saved-secret:${secret.id}:default`,
                                                        title: isDefault ? t('secrets.actions.unsetDefault') : t('secrets.actions.setDefault'),
                                                        icon: 'star',
                                                        color: isDefault ? theme.colors.button.primary.background : theme.colors.text.secondary,
                                                        onPress: () => props.onSetDefaultId?.(isDefault ? null : secret.id),
                                                    },
                                                ]}
                                            />
                                        )}

                                        {props.allowEdit !== false && (onRenamePersonal || onRotatePersonal || onDeletePersonal) && (
                                            <ItemRowActions
                                                title={secret.name}
                                                overflowTriggerTestID={`saved-secret:${secret.id}:more`}
                                                compactActionIds={['edit']}
                                                actions={[
                                                    ...(onRenamePersonal ? [{ id: 'edit', inlineTestID: `saved-secret:${secret.id}:rename`, title: t('common.rename'), icon: 'pencil' as const, onPress: () => { void onRenamePersonal(secret); } }] : []),
                                                    ...(onRotatePersonal ? [{ id: 'replace', inlineTestID: `saved-secret:${secret.id}:replace`, title: t('secrets.actions.replaceValue'), icon: 'arrow-clockwise' as const, onPress: () => { void onRotatePersonal(secret); } }] : []),
                                                    ...(props.onSharePersonal ? [{
                                                        id: 'share',
                                                        inlineTestID: `saved-secret:${secret.id}:share`,
                                                        title: t('common.share'),
                                                        icon: 'users' as const,
                                                        disabled: props.sharingPersonalId !== null && props.sharingPersonalId !== undefined,
                                                        onPress: () => props.onSharePersonal?.(secret),
                                                    }] : []),
                                                    ...(onDeletePersonal ? [{ id: 'delete', inlineTestID: `saved-secret:${secret.id}:delete`, title: t('common.delete'), icon: 'trash' as const, destructive: true, onPress: () => { void deleteSecret(secret); } }] : []),
                                                ]}
                                            />
                                        )}

                                        {props.onSelectId && (
                                            <View style={{ width: 24, alignItems: 'center', justifyContent: 'center' }}>
                                                <Icon
                                                    name="check-circle"
                                                    size={24}
                                                    color={theme.colors.text.primary}
                                                    style={{ opacity: isSelected ? 1 : 0 }}
                                                />
                                            </View>
                                        )}
                                    </View>
                                )}
                            />
                        );
                    })}
                    {ownerSharedEntries.map((entry, idx) => renderSharedEntry(entry, idx, ownerSharedEntries.length))}
                    {ownerCorruptEntries.map((entry, idx) => renderCorruptEntry(entry, idx, ownerCorruptEntries.length))}
                    </>
                )}
            </ItemGroup>
            {recipientSharedEntries.length + recipientCorruptEntries.length > 0 ? (
                <ItemGroup title={t('secrets.catalog.relationship.recipient')}>
                    {recipientSharedEntries.map((entry, idx) => renderSharedEntry(entry, idx, recipientSharedEntries.length))}
                    {recipientCorruptEntries.map((entry, idx) => renderCorruptEntry(entry, idx, recipientCorruptEntries.length))}
                </ItemGroup>
            ) : null}
            <ItemGroup footer={groupFooter}>
                {props.onCreateShared ? (
                    <Item
                        testID="saved-secret-create-shared"
                        title={t('secrets.catalog.createSharedTitle')}
                        subtitle={t('secrets.catalog.createSharedSubtitle')}
                        icon={<Icon name="users" size={29} color={theme.colors.button.secondary.tint} />}
                        onPress={props.onCreateShared}
                        showChevron={false}
                    />
                ) : null}
                {props.allowAdd !== false && onCreatePersonal ? (
                    <InlineAddExpander
                        triggerTestID="saved-secret-add"
                        isOpen={isAddExpanded}
                        onOpenChange={setIsAddExpanded}
                        title={t('common.add')}
                        subtitle={t('secrets.addSubtitle')}
                        icon={<Icon name="plus-circle" size={29} color={theme.colors.button.secondary.tint} />}
                        onCancel={resetAddDraft}
                        onSave={submitAddSecret}
                        saveDisabled={!draftName.trim() || draftValue.length === 0}
                        cancelLabel={t('common.cancel')}
                        saveLabel={t('common.save')}
                        autoFocusRef={nameInputRef}
                    >
                        <Text style={styles.fieldLabel}>{t('secrets.fields.name')}</Text>
                        <TextInput
                            ref={nameInputRef}
                            testID="saved-secret-add-name"
                            style={styles.textInput}
                            placeholder={t('secrets.placeholders.nameExample')}
                            placeholderTextColor={theme.colors.input.placeholder}
                            value={draftName}
                            onChangeText={setDraftName}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />

                        <View style={{ height: 12 }} />

                        <Text style={styles.fieldLabel}>{t('secrets.fields.value')}</Text>
                        <TextInput
                            testID="saved-secret-add-value"
                            style={styles.textInput}
                            placeholder={t('secrets.placeholders.valueExample')}
                            placeholderTextColor={theme.colors.input.placeholder}
                            value={draftValue}
                            onChangeText={setDraftValue}
                            autoCapitalize="none"
                            autoCorrect={false}
                            secureTextEntry
                            textContentType={Platform.OS === 'ios' ? 'password' : undefined}
                        />
                    </InlineAddExpander>
                ) : null}
            </ItemGroup>
        </>
    );

    if (props.wrapInItemList === false) {
        return group;
    }

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {group}
        </ItemList>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    fieldLabel: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.text.secondary,
        marginBottom: 8,
    },
    textInput: {
        ...Typography.default('regular'),
        backgroundColor: theme.colors.input.background,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: Platform.select({ ios: 8, default: 10 }),
        fontSize: Platform.select({ ios: 16, default: 16 }),
        lineHeight: Platform.select({ ios: 20, default: 22 }),
        letterSpacing: Platform.select({ ios: -0.24, default: 0.1 }),
        color: theme.colors.input.text,
    },
}));

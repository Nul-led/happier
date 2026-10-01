import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SavedSecretCatalogCorruptEntryV1, SavedSecretCatalogEntryV1 } from '@happier-dev/protocol';

import { sharedSecretProvenanceSegments, sharedSecretStatusLabel } from '@/components/secrets/savedSecretRowCopy';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import type { SavedSecret } from '@/sync/domains/settings/savedSecretTypes';
import type { SavedSecretReferenceResolution } from '@/sync/store/settings/savedSecretCatalogSnapshot';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { t } from '@/text';
import { collectionListStyles } from '@/components/ui/lists/collection/CollectionList';
import { Icon } from '@/components/ui/icons/Icon';

type CorruptOwnerEntry = Extract<SavedSecretCatalogCorruptEntryV1, { relationship: 'owner' }>;

export type SecretsSettingsPageProps = Readonly<{
    personalSecrets: readonly SavedSecret[];
    sharedEntries: readonly SavedSecretCatalogEntryV1[];
    /** Settings-only repair projection: rows the Home cannot read, with the owner's delete. */
    corruptEntries: readonly SavedSecretCatalogCorruptEntryV1[];
    resolveSharedReference: (ref: string) => SavedSecretReferenceResolution;
    /** The shared catalog is showing last-known rows because a refresh failed. */
    sharedCatalogStale: boolean;
    onRetrySharedCatalog?: () => void;

    onRenamePersonal: (secret: SavedSecret) => Promise<boolean>;
    onRotatePersonal: (secret: SavedSecret) => Promise<boolean>;
    onDeletePersonal: (secret: SavedSecret) => Promise<boolean>;
    /** Opens the access editor for a still-personal secret; absent where sharing is unavailable. */
    onSharePersonal?: (secret: SavedSecret) => void;

    onRenameShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onRotateShared?: (entry: SavedSecretCatalogEntryV1) => void;
    /** Converts an owned end-to-end encrypted resource to Home-managed storage; absent where not allowed. */
    onMakeSharedHomeManaged?: (entry: SavedSecretCatalogEntryV1) => void;
    /** Converts an owned Home-managed resource to end-to-end encrypted storage; absent where not allowed. */
    onEncryptShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onManageAccessShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onDeleteShared?: (entry: SavedSecretCatalogEntryV1) => void;
    onDeleteCorruptShared?: (entry: CorruptOwnerEntry) => void;
    sharedMutationsDisabled: boolean;

    approvalId: string | null;
    onOpenApproval?: () => void;

    /** Opens the draft row at the top of the collection. */
    onAdd: () => void;
    onCancelAdd: () => void;
    /** The one create editor, rendered in the draft row while adding. */
    createEditor: React.ReactNode | null;
    /** The one secret whose recipients are being chosen, with its editor, shown inside its row. */
    accessEditor: Readonly<{ key: string; element: React.ReactNode }> | null;
}>;

/** A secret's type; shared rows the Home cannot fully read may not carry one. */
function kindLabel(kind: SavedSecret['kind'] | null): string | null {
    return kind ? t(`secrets.catalog.kinds.${kind}`) : null;
}

function audienceSummary(entry: SavedSecretCatalogEntryV1): string {
    const audience = entry.audience;
    const count = audience ? audience.accounts.length + audience.teams.length + audience.groups.length : 0;
    return count === 0 ? t('secretsSettings.accessOnlyYou') : t('secretsSettings.accessRecipients', { count });
}

function storageLabel(mode: SavedSecretCatalogEntryV1['encryptionMode']): string | null {
    if (mode === 'e2ee') return t('secretsSettings.storageE2ee');
    if (mode === 'plain') return t('secretsSettings.storagePlain');
    return null;
}

/**
 * Settings → Secrets: the Account's Saved Secrets as a shallow collection. Each secret expands in
 * place to show its value (never displayed), where it is kept and who can use it, with the actions
 * its capabilities allow. Adding opens a draft row at the top with the one create editor; choosing
 * recipients opens the access editor inside the secret's own row. Values are never shown.
 */
export const SecretsSettingsPage = React.memo(function SecretsSettingsPage(props: SecretsSettingsPageProps) {
    const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
    const adding = props.createEditor !== null;
    const accessKey = props.accessEditor?.key ?? null;
    const isExpanded = (key: string) => key === accessKey || key === expandedKey;
    const toggle = React.useCallback((key: string, next: boolean) => {
        setExpandedKey((current) => (next ? key : current === key ? null : current));
    }, []);

    const ownerShared = props.sharedEntries.filter((entry) => entry.relationship === 'owner');
    const recipientShared = props.sharedEntries.filter((entry) => entry.relationship === 'recipient');
    const ownerCorrupt = props.corruptEntries.filter((entry): entry is CorruptOwnerEntry => entry.relationship === 'owner');
    const recipientCorrupt = props.corruptEntries.filter((entry) => entry.relationship === 'recipient');
    const yoursEmpty = props.personalSecrets.length === 0 && ownerShared.length === 0 && ownerCorrupt.length === 0;

    return (
        <ItemList presentation="page" keyboardShouldPersistTaps="handled">
            <SettingsPageHeader description={t('secretsSettings.purpose')} />

            {props.approvalId && props.onOpenApproval ? (
                <ItemGroup>
                    <Item
                        testID="saved-secret-approval"
                        icon={<Icon name="shield-check" />}
                        title={t('approvals.title')}
                        subtitle={t('secrets.catalog.approvalPending')}
                        subtitleLines={0}
                        accessibilityLiveRegion="polite"
                        onPress={props.onOpenApproval}
                    />
                </ItemGroup>
            ) : null}
            {props.sharedCatalogStale && props.onRetrySharedCatalog ? (
                <ItemGroup>
                    <Item
                        testID="saved-secret-catalog-retry"
                        title={t('secretsSettings.staleTitle')}
                        subtitle={t('secretsSettings.staleDescription')}
                        subtitleLeading={<View style={collectionListStyles.troubleDot} />}
                        showChevron={false}
                        rightElementOutsidePressable
                        rightElement={(
                            <RoundButton
                                testID="saved-secret-catalog-retry-button"
                                size="small"
                                display="secondary"
                                title={t('common.retry')}
                                onPress={props.onRetrySharedCatalog}
                            />
                        )}
                    />
                </ItemGroup>
            ) : null}

            <ItemGroup
                title={t('secretsSettings.yoursTitle')}
                description={t('secretsSettings.yoursDescription')}
                action={<AddSecretAction disabled={adding} onPress={props.onAdd} />}
            >
                {adding ? (
                    <ExpandableItem
                        testID="saved-secret-draft"
                        expanded
                        onExpandedChange={(next) => { if (!next) props.onCancelAdd(); }}
                        header={({ headerProps }) => (
                            <Item {...headerProps} title={t('secretsSettings.newSecret')} showChevron={false} />
                        )}
                    >
                        {props.createEditor}
                    </ExpandableItem>
                ) : null}
                {yoursEmpty && !adding ? (
                    <Item
                        testID="saved-secret:empty"
                        title={t('secretsSettings.emptyTitle')}
                        subtitle={t('secretsSettings.emptyDescription')}
                        subtitleLines={0}
                        mode="info"
                        showChevron={false}
                    />
                ) : null}
                {props.personalSecrets.map((secret) => (
                    <PersonalSecretRow
                        key={secret.id}
                        secret={secret}
                        expanded={isExpanded(secret.id)}
                        onExpandedChange={(next) => toggle(secret.id, next)}
                        accessEditor={accessKey === secret.id ? props.accessEditor?.element ?? null : null}
                        onRename={props.onRenamePersonal}
                        onRotate={props.onRotatePersonal}
                        onDelete={props.onDeletePersonal}
                        onShare={props.onSharePersonal}
                        shareDisabled={accessKey !== null}
                    />
                ))}
                {ownerShared.map((entry) => (
                    <OwnedSharedSecretRow
                        key={entry.ref}
                        entry={entry}
                        status={props.resolveSharedReference(entry.ref).status ?? entry.materialStatus}
                        expanded={isExpanded(entry.ref)}
                        onExpandedChange={(next) => toggle(entry.ref, next)}
                        accessEditor={accessKey === entry.ref ? props.accessEditor?.element ?? null : null}
                        disabled={props.sharedMutationsDisabled}
                        onRename={props.onRenameShared}
                        onRotate={props.onRotateShared}
                        onMakeHomeManaged={props.onMakeSharedHomeManaged}
                        onEncrypt={props.onEncryptShared}
                        onManageAccess={props.onManageAccessShared}
                        onDelete={props.onDeleteShared}
                    />
                ))}
                {ownerCorrupt.map((entry, idx) => (
                    <CorruptSecretRow
                        key={`owner:${entry.repair.resourceId}`}
                        testID={`saved-secret-corrupt:owner:${idx}`}
                        relationship="owner"
                        onDelete={props.onDeleteCorruptShared ? () => props.onDeleteCorruptShared?.(entry) : undefined}
                        deleteTestID={`saved-secret-corrupt:owner:${idx}:delete`}
                        disabled={props.sharedMutationsDisabled}
                    />
                ))}
            </ItemGroup>

            {recipientShared.length + recipientCorrupt.length > 0 ? (
                <ItemGroup
                    title={t('secretsSettings.sharedWithYouTitle')}
                    description={t('secretsSettings.sharedWithYouDescription')}
                >
                    {recipientShared.map((entry) => (
                        <RecipientSecretRow
                            key={entry.ref}
                            entry={entry}
                            status={props.resolveSharedReference(entry.ref).status ?? entry.materialStatus}
                        />
                    ))}
                    {recipientCorrupt.map((_entry, idx) => (
                        <CorruptSecretRow
                            key={`recipient:${idx}`}
                            testID={`saved-secret-corrupt:recipient:${idx}`}
                            relationship="recipient"
                        />
                    ))}
                </ItemGroup>
            ) : null}
        </ItemList>
    );
});

function AddSecretAction(props: Readonly<{ disabled: boolean; onPress: () => void }>) {
    return (
        <SectionActionButton
            testID="saved-secret-add"
            icon="plus"
            title={t('secretsSettings.add')}
            disabled={props.disabled}
            onPress={props.onPress}
        />
    );
}

/** The value row every secret shares: saved, never shown, replaceable when the capability allows. */
function SecretValueRow(props: Readonly<{ replaceTestID: string; onReplace?: () => void; disabled?: boolean }>) {
    return (
        <Item
            title={t('secretsSettings.valueTitle')}
            subtitle={t('secretsSettings.valueSaved')}
            showChevron={false}
            showDivider={false}
            rightElement={props.onReplace ? (
                <RoundButton
                    testID={props.replaceTestID}
                    size="small"
                    display="secondary"
                    title={t('secrets.actions.replace')}
                    disabled={props.disabled}
                    onPress={props.onReplace}
                />
            ) : undefined}
        />
    );
}

/** The access row: who can use the secret, then the access editor in place when it is open. */
function SecretAccessRow(props: Readonly<{
    summary: string;
    actionTitle: string;
    actionTestID: string;
    onAction: () => void;
    disabled?: boolean;
    editor: React.ReactNode | null;
}>) {
    return (
        <>
            <Item
                title={t('secretsSettings.accessTitle')}
                subtitle={props.summary}
                subtitleLines={0}
                showChevron={false}
                showDivider={false}
                rightElement={props.editor ? undefined : (
                    <RoundButton
                        testID={props.actionTestID}
                        size="small"
                        display="secondary"
                        title={props.actionTitle}
                        disabled={props.disabled}
                        onPress={props.onAction}
                    />
                )}
            />
            {props.editor}
        </>
    );
}

/** Rare operations close the expanded row: quiet ones first, the irreversible delete at the end. */
function SecretActionsRow(props: Readonly<{ children: React.ReactNode; destructive?: React.ReactNode }>) {
    const styles = stylesheet;
    return (
        <View style={styles.actions}>
            {props.children}
            {props.destructive ? <View style={styles.destructive}>{props.destructive}</View> : null}
        </View>
    );
}

function DeleteButton(props: Readonly<{ testID: string; onPress: () => void; disabled?: boolean }>) {
    return (
        <RoundButton
            testID={props.testID}
            size="small"
            display="destructive"
            title={t('common.delete')}
            disabled={props.disabled}
            onPress={props.onPress}
        />
    );
}

function RenameButton(props: Readonly<{ testID: string; onPress: () => void; disabled?: boolean }>) {
    return (
        <RoundButton
            testID={props.testID}
            size="small"
            display="secondary"
            title={t('common.rename')}
            disabled={props.disabled}
            onPress={props.onPress}
        />
    );
}

const PersonalSecretRow = React.memo(function PersonalSecretRow(props: Readonly<{
    secret: SavedSecret;
    expanded: boolean;
    onExpandedChange: (next: boolean) => void;
    accessEditor: React.ReactNode | null;
    onRename: (secret: SavedSecret) => Promise<boolean>;
    onRotate: (secret: SavedSecret) => Promise<boolean>;
    onDelete: (secret: SavedSecret) => Promise<boolean>;
    onShare?: (secret: SavedSecret) => void;
    shareDisabled: boolean;
}>) {
    const { secret } = props;
    return (
        <ExpandableItem
            testID={`saved-secret:${secret.id}`}
            expanded={props.expanded}
            onExpandedChange={props.onExpandedChange}
            header={({ headerProps }) => (
                <Item
                    {...headerProps}
                    testID={`saved-secret:${secret.id}:header`}
                    title={secret.name}
                    subtitle={[kindLabel(secret.kind), t('secretsSettings.accessOnlyYou')].filter(Boolean).join(' · ')}
                    showChevron={false}
                />
            )}
        >
            <SecretValueRow replaceTestID={`saved-secret:${secret.id}:replace`} onReplace={() => { void props.onRotate(secret); }} />
            {props.onShare ? (
                <SecretAccessRow
                    summary={`${t('secretsSettings.accessOnlyYou')}. ${t('secretsSettings.sharePersonalDescription')}`}
                    actionTitle={t('secretsSettings.share')}
                    actionTestID={`saved-secret:${secret.id}:share`}
                    onAction={() => props.onShare?.(secret)}
                    disabled={props.shareDisabled}
                    editor={props.accessEditor}
                />
            ) : null}
            <SecretActionsRow
                destructive={<DeleteButton testID={`saved-secret:${secret.id}:delete`} onPress={() => { void props.onDelete(secret); }} />}
            >
                <RenameButton testID={`saved-secret:${secret.id}:rename`} onPress={() => { void props.onRename(secret); }} />
            </SecretActionsRow>
        </ExpandableItem>
    );
});

const OwnedSharedSecretRow = React.memo(function OwnedSharedSecretRow(props: Readonly<{
    entry: SavedSecretCatalogEntryV1;
    status: SavedSecretCatalogEntryV1['materialStatus'];
    expanded: boolean;
    onExpandedChange: (next: boolean) => void;
    accessEditor: React.ReactNode | null;
    disabled: boolean;
    onRename?: (entry: SavedSecretCatalogEntryV1) => void;
    onRotate?: (entry: SavedSecretCatalogEntryV1) => void;
    onMakeHomeManaged?: (entry: SavedSecretCatalogEntryV1) => void;
    onEncrypt?: (entry: SavedSecretCatalogEntryV1) => void;
    onManageAccess?: (entry: SavedSecretCatalogEntryV1) => void;
    onDelete?: (entry: SavedSecretCatalogEntryV1) => void;
}>) {
    const { entry, status } = props;
    const name = entry.name ?? t('secrets.catalog.unavailableName');
    const storage = storageLabel(entry.encryptionMode);
    const troubled = status !== 'ready';
    const summary = [
        kindLabel(entry.kind),
        storage,
        audienceSummary(entry),
        troubled ? sharedSecretStatusLabel(status) : null,
    ].filter((part): part is string => Boolean(part)).join(' · ');
    // Conversion rewrites the resource's content through the same update a rotation uses, so it is
    // offered exactly where a rotation is, out of the row's known current mode, and only where the
    // screen allows that direction.
    const convert = entry.encryptionMode === 'e2ee' ? props.onMakeHomeManaged
        : entry.encryptionMode === 'plain' ? props.onEncrypt
            : undefined;
    const canConvert = entry.capabilities.rotate && Boolean(convert);
    const canRename = entry.capabilities.rename && Boolean(props.onRename);
    const canDelete = entry.capabilities.delete && Boolean(props.onDelete);
    return (
        <ExpandableItem
            testID={`saved-secret:${entry.ref}`}
            expanded={props.expanded}
            onExpandedChange={props.onExpandedChange}
            header={({ headerProps }) => (
                <Item
                    {...headerProps}
                    testID={`saved-secret:${entry.ref}:header`}
                    title={name}
                    subtitle={summary}
                    subtitleLeading={troubled ? <View style={collectionListStyles.troubleDot} /> : undefined}
                    accessibilityLabel={[name, t('secrets.catalog.relationship.owner'), summary].join(', ')}
                    showChevron={false}
                />
            )}
        >
            <SecretValueRow
                replaceTestID={`saved-secret:${entry.ref}:rotate`}
                onReplace={entry.capabilities.rotate && props.onRotate ? () => props.onRotate?.(entry) : undefined}
                disabled={props.disabled}
            />
            {storage ? (
                <Item
                    title={t('secretsSettings.storageTitle')}
                    subtitle={`${storage}. ${entry.encryptionMode === 'e2ee'
                        ? t('secretsSettings.storageE2eeDescription')
                        : t('secretsSettings.storagePlainDescription')}`}
                    subtitleLines={0}
                    showChevron={false}
                    showDivider={false}
                    rightElement={canConvert ? (
                        <RoundButton
                            testID={`saved-secret:${entry.ref}:convertMode`}
                            size="small"
                            display="secondary"
                            title={entry.encryptionMode === 'e2ee'
                                ? t('secrets.catalog.actions.convertToPlain')
                                : t('secrets.catalog.actions.convertToE2ee')}
                            disabled={props.disabled}
                            onPress={() => convert?.(entry)}
                        />
                    ) : undefined}
                />
            ) : null}
            {entry.capabilities.manageAccess && props.onManageAccess ? (
                <SecretAccessRow
                    summary={audienceSummary(entry)}
                    actionTitle={t('secretsSettings.manage')}
                    actionTestID={`saved-secret:${entry.ref}:manageAccess`}
                    onAction={() => props.onManageAccess?.(entry)}
                    disabled={props.disabled}
                    editor={props.accessEditor}
                />
            ) : null}
            {canRename || canDelete ? (
                <SecretActionsRow
                    destructive={canDelete ? (
                        <DeleteButton testID={`saved-secret:${entry.ref}:delete`} disabled={props.disabled} onPress={() => props.onDelete?.(entry)} />
                    ) : undefined}
                >
                    {canRename ? (
                        <RenameButton testID={`saved-secret:${entry.ref}:rename`} disabled={props.disabled} onPress={() => props.onRename?.(entry)} />
                    ) : null}
                </SecretActionsRow>
            ) : null}
        </ExpandableItem>
    );
});

/** A secret someone shared with this Account: who shared it and through what, never its value. */
function RecipientSecretRow(props: Readonly<{
    entry: SavedSecretCatalogEntryV1;
    status: SavedSecretCatalogEntryV1['materialStatus'];
}>) {
    const { entry, status } = props;
    const name = entry.name ?? t('secrets.catalog.unavailableName');
    const troubled = status !== 'ready';
    const provenance = sharedSecretProvenanceSegments(entry);
    const summary = [...provenance, ...(troubled ? [sharedSecretStatusLabel(status)] : [])].join(' · ');
    return (
        <Item
            testID={`saved-secret:${entry.ref}`}
            title={name}
            subtitle={summary}
            subtitleLines={0}
            subtitleLeading={troubled ? <View style={collectionListStyles.troubleDot} /> : undefined}
            accessibilityLabel={[name, t('secrets.catalog.relationship.recipient'), summary].join(', ')}
            mode="info"
            showChevron={false}
        />
    );
}

/** A secret the Home cannot read: informational, with the owner's delete as the only repair. */
function CorruptSecretRow(props: Readonly<{
    testID: string;
    relationship: 'owner' | 'recipient';
    onDelete?: () => void;
    deleteTestID?: string;
    disabled?: boolean;
}>) {
    const name = t('secrets.catalog.unavailableName');
    const status = t('secrets.catalog.status.resource_corrupt');
    return (
        <Item
            testID={props.testID}
            title={name}
            subtitle={status}
            subtitleLeading={<View style={collectionListStyles.troubleDot} />}
            accessibilityLabel={[
                name,
                props.relationship === 'owner'
                    ? t('secrets.catalog.relationship.owner')
                    : t('secrets.catalog.relationship.recipient'),
                status,
            ].join(', ')}
            mode="info"
            showChevron={false}
            rightElementOutsidePressable={Boolean(props.onDelete)}
            rightElement={props.onDelete ? (
                <DeleteButton testID={props.deleteTestID ?? `${props.testID}:delete`} disabled={props.disabled} onPress={props.onDelete} />
            ) : undefined}
        />
    );
}

const stylesheet = StyleSheet.create(() => ({
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 16,
    },
    destructive: {
        marginLeft: 'auto',
    },
}));

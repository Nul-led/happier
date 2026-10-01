import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { SavedSecret } from '@happier-dev/protocol';

import type { ActionApprovalRegistration } from '@/components/approvals/actionApprovalContinuation';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { createSavedSecretResource } from '@/sync/ops/settings/savedSecretResourceOperations';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';

import {
    createEmptySavedSecretGrantDraft,
    savedSecretGrantInputs,
} from '@/components/sharing/secrets/savedSecretGrantDraft';
import { SavedSecretShareSheet } from '@/components/sharing/secrets/SavedSecretShareSheet';

const SECRET_KINDS = ['apiKey', 'token', 'password', 'other'] as const satisfies readonly SavedSecret['kind'][];

type SecretStorage = 'personal' | 'shared';

/**
 * The one editor that adds a Saved Secret, shown in the draft row of the Secrets collection.
 *
 * A secret is kept either in the Account's own settings (personal, through the catalog's personal
 * writer) or as a resource on this Home that can be shared (through the shared-resource writer).
 * The choice is offered only where both writers are available; each choice calls its own writer, so
 * nothing about either write changes. A value is entered once and never shown again.
 */
export const SavedSecretCreateEditor = React.memo(function SavedSecretCreateEditor(props: Readonly<{
    /** The Home and Account a shared secret is created on; without it only a personal secret can be added. */
    scope: ServerAccountScope | null;
    /** The catalog's personal writer; absent where only shared secrets can be created. */
    onCreatePersonal?: (input: Readonly<{ name: string; value: string }>) => Promise<string | null>;
    /** Whether this Home allows shared secrets. Defaults to available when a scope is given. */
    sharedAvailable?: boolean;
    approvalPending: boolean;
    approvalId?: string | null;
    onOpenApproval?: () => void;
    requestApproval: (registration: ActionApprovalRegistration) => void;
    onCancel: () => void;
    onDirtyChange?: (dirty: boolean) => void;
    /** The new secret's reference: a personal id or a shared resource ref. */
    onCreated: (ref: string, storage: SecretStorage) => void | Promise<void>;
}>) {
    const { theme } = useUnistyles();
    const sharedAvailable = props.scope !== null && props.sharedAvailable !== false;
    const personalAvailable = Boolean(props.onCreatePersonal);
    const [chosenStorage, setChosenStorage] = React.useState<SecretStorage>('personal');
    const storage: SecretStorage = !personalAvailable ? 'shared' : !sharedAvailable ? 'personal' : chosenStorage;
    const [name, setName] = React.useState('');
    const [value, setValue] = React.useState('');
    const [kind, setKind] = React.useState<SavedSecret['kind']>('apiKey');
    const [grants, setGrants] = React.useState(createEmptySavedSecretGrantDraft);
    const [submitting, setSubmitting] = React.useState(false);
    const [failure, setFailure] = React.useState<string | null>(null);
    const dirty = name.length > 0 || value.length > 0 || kind !== 'apiKey'
        || chosenStorage !== 'personal' || grants.length > 0;
    React.useEffect(() => { props.onDirtyChange?.(dirty); }, [dirty, props.onDirtyChange]);
    const operationInFlight = React.useRef(false);
    const scopeKey = props.scope ? `${props.scope.serverId}:${props.scope.accountId}` : 'unscoped';
    const currentScopeKey = React.useRef(scopeKey);
    currentScopeKey.current = scopeKey;

    // The draft key is Home + viewer Account (plan 10.09 §14: Home server
    // identity + Team + resource + viewer Account; a new secret has no Team or
    // resource yet). A scope change is therefore a different draft: a value
    // typed for one Home must never be submittable to another, and its
    // recipients are that Home's identities, so the whole draft clears in the
    // same render that shows the new scope.
    const [draftScopeKey, setDraftScopeKey] = React.useState(scopeKey);
    if (draftScopeKey !== scopeKey) {
        setDraftScopeKey(scopeKey);
        setName('');
        setValue('');
        setKind('apiKey');
        setGrants(createEmptySavedSecretGrantDraft);
    }

    React.useEffect(() => {
        operationInFlight.current = false;
        setSubmitting(false);
        setFailure(null);
    }, [scopeKey]);

    const finishCreated = React.useCallback(async (ref: string, requestedScopeKey: string, created: SecretStorage) => {
        if (currentScopeKey.current !== requestedScopeKey) return;
        setSubmitting(false);
        operationInFlight.current = false;
        await props.onCreated(ref, created);
    }, [props.onCreated]);

    const submitPersonal = React.useCallback(async (trimmedName: string) => {
        const create = props.onCreatePersonal;
        if (!create) return;
        operationInFlight.current = true;
        setSubmitting(true);
        setFailure(null);
        // The personal writer reports its own failure; a null id leaves the draft for another try.
        const createdId = await create({ name: trimmedName, value });
        if (currentScopeKey.current !== scopeKey) return;
        if (createdId) {
            await finishCreated(createdId, scopeKey, 'personal');
            return;
        }
        operationInFlight.current = false;
        setSubmitting(false);
    }, [finishCreated, props.onCreatePersonal, scopeKey, value]);

    const submitShared = React.useCallback(async (trimmedName: string) => {
        const scope = props.scope;
        if (!scope) return;
        const grantCount = grants.length;
        if (grantCount > 0) {
            const confirmed = await Modal.confirm(
                t('secrets.catalog.shareDisclosureTitle'),
                t('secrets.catalog.shareDisclosureBody'),
                {
                    cancelText: t('common.cancel'),
                    confirmText: t('secrets.catalog.shareDisclosureConfirm', {
                        target: t('secrets.catalog.shareDisclosureTargetCount', { count: grantCount }),
                    }),
                },
            );
            if (!confirmed || currentScopeKey.current !== scopeKey) return;
        }
        operationInFlight.current = true;
        setSubmitting(true);
        setFailure(null);
        try {
            const result = await createSavedSecretResource({
                scope,
                name: trimmedName,
                kind,
                value,
                ...savedSecretGrantInputs(grants),
                onApprovalSucceeded: ({ resourceRef }) => finishCreated(resourceRef, scopeKey, 'shared'),
                onApprovalFailed: () => {
                    if (currentScopeKey.current !== scopeKey) return;
                    operationInFlight.current = false;
                    setSubmitting(false);
                    setFailure(t('secrets.catalog.approvalDeclined'));
                },
            });
            if (currentScopeKey.current !== scopeKey) return;
            if (result.ok) await finishCreated(result.resourceRef, scopeKey, 'shared');
            else {
                operationInFlight.current = false;
                setSubmitting(false);
                setFailure(result.reason === 'outcome_unknown'
                    ? t('secrets.catalog.outcomeUnknown')
                    : t('secrets.catalog.operationFailed'));
            }
        } catch (cause) {
            if (currentScopeKey.current !== scopeKey) return;
            if (isTeamActionApprovalPendingError(cause)) {
                props.requestApproval(cause.registration);
                return;
            }
            operationInFlight.current = false;
            setSubmitting(false);
            setFailure(t('secrets.catalog.operationFailed'));
        }
    }, [finishCreated, grants, kind, props.requestApproval, props.scope, scopeKey, value]);

    const submit = React.useCallback(async () => {
        const trimmedName = name.trim();
        if (!trimmedName || value.length === 0 || operationInFlight.current || props.approvalPending) return;
        if (storage === 'personal') await submitPersonal(trimmedName);
        else await submitShared(trimmedName);
    }, [name, props.approvalPending, storage, submitPersonal, submitShared, value.length]);

    const busy = submitting || props.approvalPending;
    const storageTabs = React.useMemo(() => [
        { id: 'personal' as const, label: t('secretsSettings.keepPersonal') },
        { id: 'shared' as const, label: t('secretsSettings.keepShared') },
    ], []);
    const kindTabs = React.useMemo(() => SECRET_KINDS.map((candidate) => ({
        id: candidate,
        label: t(`secrets.catalog.kinds.${candidate}`),
    })), []);

    return (
        <View style={styles.body} testID="saved-secret-create-editor">
            <View style={styles.fields}>
                <FieldItem label={t('secrets.fields.name')}>
                    <FieldTextInput
                        testID="saved-secret-create-name"
                        value={name}
                        onChangeText={setName}
                        placeholder={t('secrets.placeholders.nameExample')}
                        accessibilityLabel={t('secrets.fields.name')}
                        editable={!busy}
                        autoFocus
                    />
                </FieldItem>
                <FieldItem label={t('secrets.fields.value')}>
                    <FieldTextInput
                        testID="saved-secret-create-value"
                        value={value}
                        onChangeText={setValue}
                        placeholder={t('secrets.placeholders.valueExample')}
                        accessibilityLabel={t('secrets.fields.value')}
                        editable={!busy}
                        secureTextEntry
                        monospace
                    />
                </FieldItem>
                {personalAvailable && sharedAvailable ? (
                    <FieldItem
                        label={t('secretsSettings.keepTitle')}
                        supportingText={storage === 'personal'
                            ? t('secretsSettings.keepPersonalDescription')
                            : t('secretsSettings.keepSharedDescription')}
                    >
                        <SegmentedTabBar
                            tabs={storageTabs}
                            activeTabId={storage}
                            onSelectTab={setChosenStorage}
                            disabled={busy}
                            testIDPrefix="saved-secret-create-storage"
                        />
                    </FieldItem>
                ) : null}
                {storage === 'shared' ? (
                    <FieldItem label={t('secrets.catalog.kindTitle')}>
                        <SegmentedTabBar
                            role="radiogroup"
                            tabs={kindTabs}
                            activeTabId={kind}
                            onSelectTab={setKind}
                            disabled={busy}
                            testIDPrefix="saved-secret-create-kind"
                        />
                    </FieldItem>
                ) : null}
            </View>
            {storage === 'shared' && props.scope ? (
                <FieldItem label={t('secretsSettings.accessTitle')}>
                    <SavedSecretShareSheet scope={props.scope} draft={grants} onChange={setGrants} disabled={busy} />
                </FieldItem>
            ) : null}
            {failure ? (
                <Text
                    testID="saved-secret-create-failure"
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[styles.notice, { color: theme.colors.state.danger.foreground }]}
                >
                    {failure}
                </Text>
            ) : null}
            {props.approvalId && props.onOpenApproval ? (
                <View style={styles.approval} testID="saved-secret-create-approval">
                    <Text accessibilityLiveRegion="polite" style={[styles.notice, styles.approvalText, { color: theme.colors.text.secondary }]}>
                        {t('secrets.catalog.approvalPending')}
                    </Text>
                    <RoundButton size="small" display="secondary" title={t('approvals.title')} onPress={props.onOpenApproval} />
                </View>
            ) : null}
            <View style={styles.actions}>
                <RoundButton
                    testID="saved-secret-create-submit"
                    size="small"
                    title={t('secretsSettings.save')}
                    loading={busy}
                    disabled={busy || !name.trim() || value.length === 0}
                    onPress={() => { void submit(); }}
                />
                <RoundButton
                    testID="saved-secret-create-cancel"
                    size="small"
                    display="secondary"
                    title={t('common.cancel')}
                    disabled={busy}
                    onPress={props.onCancel}
                />
            </View>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, gap: 14 },
    // Text fields stay a readable width on wide pages instead of spanning the sheet.
    fields: { gap: 12, maxWidth: 480, width: '100%' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    approval: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    approvalText: { flexShrink: 1 },
    notice: { fontSize: 13, lineHeight: 18 },
}));

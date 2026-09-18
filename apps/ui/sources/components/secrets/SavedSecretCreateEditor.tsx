import * as React from 'react';
import type { SavedSecret } from '@happier-dev/protocol';

import type { ActionApprovalRegistration } from '@/components/approvals/actionApprovalContinuation';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { TextInput } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { createSavedSecretResource } from '@/sync/ops/settings/savedSecretResourceOperations';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';

import {
    createEmptySavedSecretGrantDraft,
    SavedSecretGrantPicker,
} from './SavedSecretGrantPicker';

const SECRET_KINDS = ['apiKey', 'token', 'password', 'other'] as const satisfies readonly SavedSecret['kind'][];

export const SavedSecretCreateEditor = React.memo(function SavedSecretCreateEditor(props: Readonly<{
    scope: ServerAccountScope;
    approvalPending: boolean;
    approvalId?: string | null;
    onOpenApproval?: () => void;
    requestApproval: (registration: ActionApprovalRegistration) => void;
    onCancel: () => void;
    onCreated: (resourceRef: string) => void | Promise<void>;
}>) {
    const [name, setName] = React.useState('');
    const [value, setValue] = React.useState('');
    const [kind, setKind] = React.useState<SavedSecret['kind']>('apiKey');
    const [grants, setGrants] = React.useState(createEmptySavedSecretGrantDraft);
    const [submitting, setSubmitting] = React.useState(false);
    const [failure, setFailure] = React.useState<string | null>(null);
    const operationInFlight = React.useRef(false);
    const scopeKey = `${props.scope.serverId}:${props.scope.accountId}`;
    const currentScopeKey = React.useRef(scopeKey);
    currentScopeKey.current = scopeKey;

    React.useEffect(() => {
        operationInFlight.current = false;
        setSubmitting(false);
        setFailure(null);
    }, [scopeKey]);

    const finishCreated = React.useCallback(async (resourceRef: string, requestedScopeKey: string) => {
        if (currentScopeKey.current !== requestedScopeKey) return;
        setSubmitting(false);
        operationInFlight.current = false;
        await props.onCreated(resourceRef);
    }, [props.onCreated]);

    const submit = React.useCallback(async () => {
        const trimmedName = name.trim();
        if (!trimmedName || value.length === 0 || operationInFlight.current || props.approvalPending) return;
        const grantCount = grants.accounts.size + grants.teams.size + grants.groups.size;
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
                scope: props.scope,
                name: trimmedName,
                kind,
                value,
                accountGrants: [...grants.accounts],
                teamGrants: [...grants.teams],
                groupGrants: [...grants.groups],
                onApprovalSucceeded: ({ resourceRef }) => finishCreated(resourceRef, scopeKey),
                onApprovalFailed: () => {
                    if (currentScopeKey.current !== scopeKey) return;
                    operationInFlight.current = false;
                    setSubmitting(false);
                    setFailure(t('secrets.catalog.approvalDeclined'));
                },
            });
            if (currentScopeKey.current !== scopeKey) return;
            if (result.ok) await finishCreated(result.resourceRef, scopeKey);
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
    }, [finishCreated, grants, kind, name, props, scopeKey, value]);

    const busy = submitting || props.approvalPending;
    return (
        <ItemList>
            {props.approvalId && props.onOpenApproval ? (
                <ItemGroup>
                    <Item
                        testID="saved-secret-create-approval"
                        title={t('approvals.title')}
                        subtitle={t('secrets.catalog.approvalPending')}
                        accessibilityLiveRegion="polite"
                        onPress={props.onOpenApproval}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            <ItemGroup title={t('secrets.catalog.createSharedTitle')} footer={failure ?? undefined}>
                <TextInput
                    testID="saved-secret-create-name"
                    value={name}
                    onChangeText={setName}
                    placeholder={t('secrets.placeholders.nameExample')}
                    accessibilityLabel={t('secrets.fields.name')}
                    editable={!busy}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                <TextInput
                    testID="saved-secret-create-value"
                    value={value}
                    onChangeText={setValue}
                    placeholder={t('secrets.placeholders.valueExample')}
                    accessibilityLabel={t('secrets.fields.value')}
                    editable={!busy}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                />
            </ItemGroup>
            <ItemGroup title={t('secrets.catalog.kindTitle')}>
                {SECRET_KINDS.map((candidate) => (
                    <Item
                        key={candidate}
                        testID={`saved-secret-create-kind:${candidate}`}
                        title={t(`secrets.catalog.kinds.${candidate}`)}
                        selected={kind === candidate}
                        accessibilityRole="radio"
                        webRole="radio"
                        accessibilityChecked={kind === candidate}
                        disabled={busy}
                        onPress={() => setKind(candidate)}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>
            <SavedSecretGrantPicker scope={props.scope} draft={grants} onChange={setGrants} disabled={busy} />
            <ItemGroup footer={props.approvalPending ? t('secrets.catalog.approvalPending') : undefined}>
                <Item title={t('common.cancel')} disabled={busy} onPress={props.onCancel} showChevron={false} />
                <Item
                    testID="saved-secret-create-submit"
                    title={t('secrets.catalog.createSharedAction')}
                    loading={busy}
                    disabled={busy || !name.trim() || value.length === 0}
                    onPress={() => { void submit(); }}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
});

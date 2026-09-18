import * as React from 'react';
import { useNavigation, useRouter } from 'expo-router';
import { AppState } from 'react-native';
import type { ManagedIdentityProviderOwnerV1, ManagedIdentityProviderV1, ManagedOidcProviderConfigV1 } from '@happier-dev/protocol';

import { CopiedPill } from '@/components/ui/copy/CopiedPill';
import { useTemporaryCopyFeedback } from '@/components/ui/copy/useTemporaryCopyFeedback';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { identityAdministrationFailureMessage } from '@/components/settings/identity/identityAdministrationFailure';
import {
    revisionedSettingsDraftTransition,
    type RevisionedSettingsDraftOrigin,
} from '@/components/settings/identity/revisionedSettingsDraft';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { TextInput } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import { t } from '@/text';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';
import { useUnsavedChangesBeforeRemoveGuard } from '@/utils/navigation/useUnsavedChangesBeforeRemoveGuard';
import { promptUnsavedChangesAlert } from '@/utils/ui/promptUnsavedChangesAlert';
import { useMountedRef } from '@/hooks/ui/useMountedRef';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import type { ActionApprovalRegistration } from '@/components/approvals/actionApprovalContinuation';

import { HomeAdministrationSection } from '../governance/HomeAdministrationSection';
import type { HomeAdministrationContext } from '../governance/homeAdministrationContext';
import { homeAdministrationIdentityProviderPath } from '../governance/homeAdministrationRoutes';
import { useManagedIdentityProviderClient, useManagedIdentityProviders } from './useManagedIdentityProviders';

export type ManagedOidcProviderDraft = Readonly<{
    displayName: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    scopes: string;
    loginClaim: string;
    emailClaim: string;
    groupsClaim: string;
    fetchUserInfo: boolean;
}>;

export type ManagedIdentityProviderSaveResult =
    | Readonly<{ kind: 'completed' }>
    | Readonly<{ kind: 'approval_pending' }>
    | Readonly<{ kind: 'failed'; code: string }>;

export const EMPTY_MANAGED_OIDC_PROVIDER_DRAFT: ManagedOidcProviderDraft = Object.freeze({
    displayName: '',
    issuer: '',
    clientId: '',
    clientSecret: '',
    scopes: 'openid profile email',
    loginClaim: 'preferred_username',
    emailClaim: 'email',
    groupsClaim: 'groups',
    fetchUserInfo: true,
});

export function managedOidcDraftFromProvider(provider: ManagedIdentityProviderV1): ManagedOidcProviderDraft {
    if (provider.kind !== 'oidc') throw new Error('identity_provider_not_oidc');
    return {
        displayName: provider.displayName,
        issuer: provider.config.issuer,
        clientId: provider.config.clientId,
        clientSecret: '',
        scopes: provider.config.scopes,
        loginClaim: provider.config.claims.login,
        emailClaim: provider.config.claims.email,
        groupsClaim: provider.config.claims.groups,
        fetchUserInfo: provider.config.fetchUserInfo,
    };
}

export function managedOidcConfigFromDraft(draft: ManagedOidcProviderDraft, current?: ManagedIdentityProviderV1): ManagedOidcProviderConfigV1 {
    if (current && current.kind !== 'oidc') throw new Error('identity_provider_not_oidc');
    return {
        v: 1,
        kind: 'oidc',
        issuer: draft.issuer.trim(),
        clientId: draft.clientId.trim(),
        clientAuthenticationMethod: current?.config.clientAuthenticationMethod ?? 'client_secret_post',
        scopes: draft.scopes.trim(),
        httpTimeoutSeconds: current?.config.httpTimeoutSeconds ?? 15,
        claims: {
            login: draft.loginClaim.trim(),
            email: draft.emailClaim.trim(),
            groups: draft.groupsClaim.trim(),
        },
        allow: current?.config.allow ?? { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
        fetchUserInfo: draft.fetchUserInfo,
        storeRefreshToken: current?.config.storeRefreshToken ?? false,
        ui: current?.config.ui ?? { buttonColor: null, iconHint: null },
    };
}

export function validateManagedIdentityProviderDraft(
    draft: ManagedOidcProviderDraft,
    requiresSecret: boolean,
): Readonly<{
    code: 'required' | 'issuer' | 'secret';
    field: keyof ManagedOidcProviderDraft;
}> | null {
    if (!draft.displayName.trim()) return { code: 'required', field: 'displayName' };
    try {
        const issuer = new URL(draft.issuer.trim());
        if (issuer.protocol !== 'https:') return { code: 'issuer', field: 'issuer' };
    } catch {
        return { code: 'issuer', field: 'issuer' };
    }
    if (!draft.clientId.trim()) return { code: 'required', field: 'clientId' };
    if (requiresSecret && !draft.clientSecret) return { code: 'secret', field: 'clientSecret' };
    if (!draft.scopes.trim()) return { code: 'required', field: 'scopes' };
    if (!draft.loginClaim.trim()) return { code: 'required', field: 'loginClaim' };
    if (!draft.emailClaim.trim()) return { code: 'required', field: 'emailClaim' };
    if (!draft.groupsClaim.trim()) return { code: 'required', field: 'groupsClaim' };
    return null;
}

type ManagedOidcProviderInputRefs = Readonly<Partial<Record<keyof ManagedOidcProviderDraft, React.RefObject<{ focus(): void } | null>>>>;

export const ManagedOidcProviderFields = React.memo(function ManagedOidcProviderFields(props: Readonly<{
    draft: ManagedOidcProviderDraft;
    isEdit: boolean;
    advanced: boolean;
    editable: boolean;
    onAdvancedChange: (advanced: boolean) => void;
    onChange: <K extends keyof ManagedOidcProviderDraft>(key: K, value: ManagedOidcProviderDraft[K]) => void;
    inputRefs?: ManagedOidcProviderInputRefs;
    testIdPrefix?: string;
}>) {
    const prefix = props.testIdPrefix ?? 'identity-provider';
    return <>
        <ItemGroup title={t('identityAdministration.configuration')}>
            <FieldItem label={t('identityAdministration.displayName')}><TextInput ref={props.inputRefs?.displayName} testID={`${prefix}-name`} accessibilityLabel={t('identityAdministration.displayName')} value={props.draft.displayName} editable={props.editable} onChangeText={(value) => props.onChange('displayName', value)} /></FieldItem>
            <FieldItem label={t('identityAdministration.issuer')}><TextInput ref={props.inputRefs?.issuer} testID={`${prefix}-issuer`} accessibilityLabel={t('identityAdministration.issuer')} value={props.draft.issuer} editable={props.editable} autoCapitalize="none" autoCorrect={false} onChangeText={(value) => props.onChange('issuer', value)} /></FieldItem>
            <FieldItem label={t('identityAdministration.clientId')}><TextInput ref={props.inputRefs?.clientId} testID={`${prefix}-client-id`} accessibilityLabel={t('identityAdministration.clientId')} value={props.draft.clientId} editable={props.editable} autoCapitalize="none" autoCorrect={false} onChangeText={(value) => props.onChange('clientId', value)} /></FieldItem>
            <FieldItem label={t('identityAdministration.clientSecret')} supportingText={props.isEdit ? t('identityAdministration.secretRetain') : undefined}><TextInput ref={props.inputRefs?.clientSecret} testID={`${prefix}-client-secret`} accessibilityLabel={t('identityAdministration.clientSecret')} value={props.draft.clientSecret} editable={props.editable} secureTextEntry autoCapitalize="none" autoCorrect={false} onChangeText={(value) => props.onChange('clientSecret', value)} /></FieldItem>
        </ItemGroup>
        <ItemGroup>
            <Item testID={`${prefix}-advanced-toggle`} title={t(props.advanced ? 'identityAdministration.hideAdvanced' : 'identityAdministration.advanced')} selected={props.advanced} disabled={!props.editable} onPress={() => props.onAdvancedChange(!props.advanced)} showChevron={false} />
        </ItemGroup>
        {props.advanced ? <ItemGroup title={t('identityAdministration.advanced')}>
            <FieldItem label={t('identityAdministration.scopes')}><TextInput ref={props.inputRefs?.scopes} testID={`${prefix}-scopes`} accessibilityLabel={t('identityAdministration.scopes')} value={props.draft.scopes} editable={props.editable} onChangeText={(value) => props.onChange('scopes', value)} /></FieldItem>
            <FieldItem label={t('identityAdministration.loginClaim')}><TextInput ref={props.inputRefs?.loginClaim} testID={`${prefix}-login-claim`} accessibilityLabel={t('identityAdministration.loginClaim')} value={props.draft.loginClaim} editable={props.editable} onChangeText={(value) => props.onChange('loginClaim', value)} /></FieldItem>
            <FieldItem label={t('identityAdministration.emailClaim')}><TextInput ref={props.inputRefs?.emailClaim} testID={`${prefix}-email-claim`} accessibilityLabel={t('identityAdministration.emailClaim')} value={props.draft.emailClaim} editable={props.editable} onChangeText={(value) => props.onChange('emailClaim', value)} /></FieldItem>
            <FieldItem label={t('identityAdministration.groupsClaim')}><TextInput ref={props.inputRefs?.groupsClaim} testID={`${prefix}-groups-claim`} accessibilityLabel={t('identityAdministration.groupsClaim')} value={props.draft.groupsClaim} editable={props.editable} onChangeText={(value) => props.onChange('groupsClaim', value)} /></FieldItem>
            <Item testID={`${prefix}-fetch-user-info`} title={t('identityAdministration.fetchUserInfo')} selected={props.draft.fetchUserInfo} disabled={!props.editable} onPress={() => props.onChange('fetchUserInfo', !props.draft.fetchUserInfo)} showChevron={false} />
        </ItemGroup> : null}
    </>;
});

export const ManagedOidcProviderEditorContent = React.memo(function ManagedOidcProviderEditorContent(props: Readonly<{
    scope: HomeAdministrationContext['scope'];
    owner: ManagedIdentityProviderOwnerV1;
    provider?: ManagedIdentityProviderV1 | null;
    loading?: boolean;
    mutationsAvailable: boolean;
    onRefreshRequested?: () => void;
    onSaved: (provider: ManagedIdentityProviderV1) => Promise<ManagedIdentityProviderSaveResult> | ManagedIdentityProviderSaveResult;
    onApprovalPending?: (registration: ActionApprovalRegistration) => void;
    additionalDirty?: boolean;
    additionalFields?: React.ReactNode;
    testIdPrefix?: string;
    saveTestId?: string;
}>) {
    const navigation = useNavigation();
    const client = useManagedIdentityProviderClient(props.scope);
    const mountedRef = useMountedRef();
    const ownerTeamId = props.owner.kind === 'team' ? props.owner.teamId : null;
    const owner = React.useMemo<ManagedIdentityProviderOwnerV1>(
        () => ownerTeamId === null ? { kind: 'home' } : { kind: 'team', teamId: ownerTeamId },
        [ownerTeamId],
    );
    const initialProvider = React.useRef(props.provider ?? null).current;
    const copyFeedback = useTemporaryCopyFeedback();
    const copyCallbackUrl = React.useCallback(async (url: string) => {
        if (!await setClipboardStringSafe(url)) {
            await Modal.alertAsync(t('common.error'), t('items.failedToCopyToClipboard'));
            return;
        }
        copyFeedback.markCopied();
    }, [copyFeedback]);
    const initialDraft = React.useRef(
        initialProvider ? managedOidcDraftFromProvider(initialProvider) : EMPTY_MANAGED_OIDC_PROVIDER_DRAFT,
    ).current;
    const [createdProvider, setCreatedProvider] = React.useState<ManagedIdentityProviderV1 | null>(null);
    const externalProviderIsNewer = Boolean(
        createdProvider
        && props.provider
        && props.provider.id === createdProvider.id
        && props.provider.revision > createdProvider.revision,
    );
    const provider = externalProviderIsNewer ? props.provider ?? null : createdProvider ?? props.provider ?? null;
    const [draft, setDraft] = React.useState<ManagedOidcProviderDraft>(initialDraft);
    const [baseline, setBaseline] = React.useState<ManagedOidcProviderDraft>(initialDraft);
    const [draftOrigin, setDraftOrigin] = React.useState<RevisionedSettingsDraftOrigin | null>(
        initialProvider ? { resourceId: initialProvider.id, revision: initialProvider.revision } : null,
    );
    const [revisionConflict, setRevisionConflict] = React.useState(false);
    const [appliedDraft, setAppliedDraft] = React.useState<ManagedOidcProviderDraft | null>(
        initialProvider ? initialDraft : null,
    );
    const [commitPending, setCommitPending] = React.useState(false);
    const [advanced, setAdvanced] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [testing, setTesting] = React.useState(false);
    const [tested, setTested] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    // React state disables the rendered controls; this ref closes the smaller
    // same-frame window before that render commits. Save and validation share
    // it because both act on the same provider revision/security revision.
    const operationInFlightRef = React.useRef<symbol | null>(null);

    React.useEffect(() => () => {
        operationInFlightRef.current = null;
    }, []);
    const displayNameInputRef = React.useRef<{ focus(): void } | null>(null);
    const issuerInputRef = React.useRef<{ focus(): void } | null>(null);
    const clientIdInputRef = React.useRef<{ focus(): void } | null>(null);
    const clientSecretInputRef = React.useRef<{ focus(): void } | null>(null);
    const scopesInputRef = React.useRef<{ focus(): void } | null>(null);
    const loginClaimInputRef = React.useRef<{ focus(): void } | null>(null);
    const emailClaimInputRef = React.useRef<{ focus(): void } | null>(null);
    const groupsClaimInputRef = React.useRef<{ focus(): void } | null>(null);
    const inputRefs = React.useMemo<ManagedOidcProviderInputRefs>(() => ({
        displayName: displayNameInputRef,
        issuer: issuerInputRef,
        clientId: clientIdInputRef,
        clientSecret: clientSecretInputRef,
        scopes: scopesInputRef,
        loginClaim: loginClaimInputRef,
        emailClaim: emailClaimInputRef,
        groupsClaim: groupsClaimInputRef,
    }), []);

    React.useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') return;
            setDraft((current) => current.clientSecret ? { ...current, clientSecret: '' } : current);
            setBaseline((current) => current.clientSecret ? { ...current, clientSecret: '' } : current);
            setAppliedDraft((current) => current?.clientSecret ? { ...current, clientSecret: '' } : current);
        });
        return () => subscription.remove();
    }, []);

    const isEdit = Boolean(provider);
    const providerDirty = JSON.stringify(draft) !== JSON.stringify(baseline);
    // A newly created provider is an incomplete two-phase Team setup until
    // `onSaved` attaches it. Keep that phase retryable after an ordinary
    // failure, while `commitPending` separately fences deferred approval from
    // replaying either mutation.
    const dirty = providerDirty || Boolean(props.additionalDirty) || Boolean(createdProvider) || commitPending;
    React.useEffect(() => {
        if (!props.provider) return;
        if (createdProvider
            && createdProvider.id === props.provider.id
            && props.provider.revision <= createdProvider.revision) return;
        const transition = revisionedSettingsDraftTransition({
            origin: draftOrigin,
            current: { resourceId: props.provider.id, revision: props.provider.revision },
            dirty: providerDirty,
        });
        if (transition === 'keep') return;
        if (transition === 'conflict') {
            setRevisionConflict(true);
            return;
        }
        const next = managedOidcDraftFromProvider(props.provider);
        setDraft(next);
        setBaseline(next);
        setAppliedDraft(next);
        setDraftOrigin({ resourceId: props.provider.id, revision: props.provider.revision });
        setRevisionConflict(false);
    }, [createdProvider, draftOrigin, props.provider, providerDirty]);
    const dirtyRef = React.useRef(dirty);
    dirtyRef.current = dirty;
    const ignoreRef = React.useRef(false);
    const requestDecision = React.useCallback(async () => await promptUnsavedChangesAlert(
        (title, message, buttons) => Modal.alert(title, message, buttons),
        {
            title: t('common.discardChanges'),
            message: t('identityAdministration.subtitle'),
            discardText: t('common.discard'),
            saveText: t('common.save'),
            keepEditingText: t('common.keepEditing'),
        },
    ), []);

    // The outcome appears in a footer below the control that was pressed, so a
    // screen reader still focused on that control would otherwise hear nothing.
    // Announcing through the same helper keeps the two exactly in step.
    const reportError = React.useCallback((message: string) => {
        if (!mountedRef.current) return;
        setError(message);
        announceAccessibilityMessage(message);
    }, [mountedRef]);
    const reportFailure = React.useCallback(
        (code: string) => reportError(identityAdministrationFailureMessage(code)),
        [reportError],
    );
    const reportSaveApprovalFailure = React.useCallback((code: string) => {
        setCommitPending(false);
        reportFailure(code);
    }, [reportFailure]);
    const reportApprovalPending = React.useCallback(
        (registration: ActionApprovalRegistration) => {
            if (!mountedRef.current) return;
            props.onApprovalPending?.(registration);
            reportError(t('connect.waitingForApproval'));
        },
        [mountedRef, props.onApprovalPending, reportError],
    );

    const update = React.useCallback(<K extends keyof ManagedOidcProviderDraft>(key: K, value: ManagedOidcProviderDraft[K]) => {
        setDraft((current) => ({ ...current, [key]: value }));
        setError(null);
        setTested(false);
    }, []);

    const reloadConflictedProvider = React.useCallback(() => {
        if (!provider) return;
        const next = managedOidcDraftFromProvider(provider);
        setDraft(next);
        setBaseline(next);
        setAppliedDraft(next);
        setDraftOrigin({ resourceId: provider.id, revision: provider.revision });
        setCreatedProvider((current) => current?.id === provider.id ? provider : null);
        setRevisionConflict(false);
        setError(null);
        setTested(false);
    }, [provider]);

    const applyValidationSuccess = React.useCallback((validated: ManagedIdentityProviderV1) => {
        if (!mountedRef.current) return;
        setCreatedProvider(createdProvider ? validated : null);
        setDraftOrigin({ resourceId: validated.id, revision: validated.revision });
        setTested(true);
    }, [createdProvider, mountedRef]);

    const testConfiguration = React.useCallback(async () => {
        if (!provider || providerDirty || revisionConflict || operationInFlightRef.current !== null) return;
        const operationIdentity = Symbol('validate-managed-identity-provider');
        operationInFlightRef.current = operationIdentity;
        setTesting(true);
        setError(null);
        setTested(false);
        try {
            const input = {
                owner,
                id: provider.id,
                expectedRevision: draftOrigin?.resourceId === provider.id ? draftOrigin.revision : provider.revision,
                expectedSecurityRevision: provider.securityRevision,
            } as const;
            const result = await client.execute('identity.providers.validate', input, {
                onApprovalSucceeded: applyValidationSuccess,
                onApprovalFailed: reportFailure,
            });
            if (result.kind === 'failed') {
                reportFailure(result.failure.code);
                return;
            }
            if (result.kind === 'approval_pending') {
                reportApprovalPending(result.approval);
                return;
            }
            applyValidationSuccess(result.value);
        } catch {
            reportError(t('identityAdministration.error'));
        } finally {
            if (operationInFlightRef.current === operationIdentity) operationInFlightRef.current = null;
            setTesting(false);
        }
    }, [applyValidationSuccess, client, draftOrigin, owner, provider, providerDirty, reportApprovalPending, reportError, reportFailure, revisionConflict]);

    const finishSavedProvider = React.useCallback(async (current: ManagedIdentityProviderV1): Promise<boolean> => {
        if (!mountedRef.current) return false;
        setCreatedProvider(current);
        setAppliedDraft(draft);
        setBaseline(draft);
        setDraftOrigin({ resourceId: current.id, revision: current.revision });
        let result: ManagedIdentityProviderSaveResult;
        try {
            result = await props.onSaved(current);
        } catch {
            setCommitPending(false);
            reportError(t('identityAdministration.error'));
            return false;
        }
        if (result.kind === 'approval_pending') {
            setCommitPending(true);
            return false;
        }
        if (result.kind === 'failed') {
            setCommitPending(false);
            reportFailure(result.code);
            return false;
        }
        const next = managedOidcDraftFromProvider(current);
        setDraft(next);
        setBaseline(next);
        setDraftOrigin({ resourceId: current.id, revision: current.revision });
        setRevisionConflict(false);
        setCommitPending(false);
        setCreatedProvider(null);
        ignoreRef.current = true;
        return true;
    }, [draft, mountedRef, props.onSaved, reportError, reportFailure]);

    const continueAfterProviderUpdate = React.useCallback(async (updated: ManagedIdentityProviderV1): Promise<boolean> => {
        if (!mountedRef.current) return false;
        let current = updated;
        setCreatedProvider(current);
        setDraftOrigin({ resourceId: current.id, revision: current.revision });
        if (draft.clientSecret && draft.clientSecret !== appliedDraft?.clientSecret) {
            const secretInput = {
                owner,
                id: current.id,
                expectedRevision: current.revision,
                clientSecret: draft.clientSecret,
            } as const;
            const secret = await client.execute('identity.providers.secret.replace', secretInput, {
                onApprovalSucceeded: async (savedProvider) => {
                    await finishSavedProvider(savedProvider);
                },
                onApprovalFailed: reportSaveApprovalFailure,
            });
            if (secret.kind === 'failed') {
                if (secret.failure.code === 'identity_provider_revision_conflict') {
                    setRevisionConflict(true);
                    props.onRefreshRequested?.();
                }
                reportFailure(secret.failure.code);
                return false;
            }
            if (secret.kind === 'approval_pending') {
                setCommitPending(true);
                reportApprovalPending(secret.approval);
                return false;
            }
            current = secret.value;
        }
        return await finishSavedProvider(current);
    }, [appliedDraft?.clientSecret, client, draft.clientSecret, finishSavedProvider, mountedRef, owner, props.onRefreshRequested, reportApprovalPending, reportFailure, reportSaveApprovalFailure]);

    const save = React.useCallback(async () => {
        if (operationInFlightRef.current !== null || commitPending) return false;
        const validation = validateManagedIdentityProviderDraft(draft, !provider);
        if (validation) {
            reportError(t(validation.code === 'issuer'
                ? 'identityAdministration.invalidIssuer'
                : validation.code === 'secret'
                    ? 'identityAdministration.secretRequired'
                    : 'identityAdministration.required'));
            if (validation.field === 'scopes' || validation.field === 'loginClaim'
                || validation.field === 'emailClaim' || validation.field === 'groupsClaim') setAdvanced(true);
            const focusInvalidField = () => inputRefs[validation.field]?.current?.focus();
            if (typeof globalThis.requestAnimationFrame === 'function') {
                globalThis.requestAnimationFrame(focusInvalidField);
            } else {
                setTimeout(focusInvalidField, 0);
            }
            return false;
        }
        const operationIdentity = Symbol('save-managed-identity-provider');
        operationInFlightRef.current = operationIdentity;
        setSaving(true);
        setError(null);
        try {
            if (!provider) {
                const createInput = {
                    owner,
                    displayName: draft.displayName.trim(),
                    config: managedOidcConfigFromDraft(draft),
                    clientSecret: draft.clientSecret,
                } as const;
                const created = await client.execute('identity.providers.create', createInput, {
                    onApprovalSucceeded: async (savedProvider) => {
                        await finishSavedProvider(savedProvider);
                    },
                    onApprovalFailed: reportSaveApprovalFailure,
                });
                if (created.kind === 'failed') {
                    reportFailure(created.failure.code);
                    return false;
                }
                if (created.kind === 'approval_pending') {
                    setCommitPending(true);
                    reportApprovalPending(created.approval);
                    return false;
                }
                return await finishSavedProvider(created.value);
            } else if (!createdProvider || JSON.stringify(draft) !== JSON.stringify(appliedDraft)) {
                const updateInput = {
                    owner,
                    id: provider.id,
                    expectedRevision: draftOrigin?.resourceId === provider.id ? draftOrigin.revision : provider.revision,
                    displayName: draft.displayName.trim(),
                    config: managedOidcConfigFromDraft(draft, provider),
                } as const;
                const updated = await client.execute('identity.providers.update', updateInput, {
                    onApprovalSucceeded: async (savedProvider) => {
                        await continueAfterProviderUpdate(savedProvider);
                    },
                    onApprovalFailed: reportSaveApprovalFailure,
                });
                if (updated.kind === 'failed') {
                    if (updated.failure.code === 'identity_provider_revision_conflict') {
                        setRevisionConflict(true);
                        props.onRefreshRequested?.();
                    }
                    reportFailure(updated.failure.code);
                    return false;
                }
                if (updated.kind === 'approval_pending') {
                    setCommitPending(true);
                    reportApprovalPending(updated.approval);
                    return false;
                }
                return await continueAfterProviderUpdate(updated.value);
            }
            return await finishSavedProvider(provider);
        } catch {
            if (provider) {
                setCreatedProvider(provider);
                setCommitPending(true);
            }
            reportError(t('identityAdministration.error'));
            return false;
        } finally {
            if (operationInFlightRef.current === operationIdentity) operationInFlightRef.current = null;
            setSaving(false);
        }
    }, [appliedDraft, client, commitPending, continueAfterProviderUpdate, createdProvider, draft, draftOrigin, finishSavedProvider, owner, props.onRefreshRequested, provider, reportApprovalPending, reportError, reportFailure, reportSaveApprovalFailure]);

    useUnsavedChangesBeforeRemoveGuard({
        ignoreRef,
        isDirty: dirty,
        isDirtyRef: dirtyRef,
        requestDecision,
        onSave: save,
        continueOnSave: false,
        onContinue: (action) => (navigation as { dispatch?: (value: unknown) => void }).dispatch?.(action),
        tag: 'ManagedIdentityProviderEditorScreen.beforeRemove',
    });
    useActiveUnsavedChangesGuard({
        navigation,
        guard: React.useMemo(() => ({
            isDirtyRef: dirtyRef,
            ignoreRef,
            requestDecision,
            onSave: save,
            continueOnSave: false,
            tag: 'ManagedIdentityProviderEditorScreen.shellGuard',
        }), [requestDecision, save]),
    });

    if (props.loading) {
        return <ItemGroup><Item title={t('common.loading')} leftElement={<ActivitySpinner />} showChevron={false} /></ItemGroup>;
    }
    const callbackUrl = provider?.callbackUrl ?? null;
    return (
        <>
            <ManagedOidcProviderFields draft={draft} isEdit={isEdit} advanced={advanced} editable={props.mutationsAvailable} onAdvancedChange={setAdvanced} onChange={update} inputRefs={inputRefs} testIdPrefix={props.testIdPrefix} />
            {callbackUrl ? (
                <ItemGroup footer={t('identityAdministration.callbackUrlHint')}>
                    <Item
                        testID={`${props.testIdPrefix ?? 'identity-provider'}-callback-url`}
                        title={t('identityAdministration.callbackUrl')}
                        subtitle={callbackUrl}
                        rightElement={<CopiedPill visible={copyFeedback.isCopied()} testID={`${props.testIdPrefix ?? 'identity-provider'}-callback-url-copied`} />}
                        onPress={() => void copyCallbackUrl(callbackUrl)}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            {props.additionalFields}
            {revisionConflict && provider ? <ItemGroup footer={t('identityAdministration.settingsChangedElsewhere')}>{draftOrigin?.resourceId !== provider.id || provider.revision > draftOrigin.revision ? <Item testID="identity-provider-reload-conflict" title={t('common.refresh')} onPress={reloadConflictedProvider} showChevron={false} /> : props.onRefreshRequested ? <Item testID="identity-provider-refresh-conflict" title={t('common.retry')} onPress={props.onRefreshRequested} showChevron={false} /> : null}</ItemGroup> : null}
            <ItemGroup footer={error ?? undefined}>
                {provider ? <Item testID={`${props.testIdPrefix ?? 'identity-provider'}-test`} title={testing ? t('identityAdministration.validating') : t('identityAdministration.validate')} detail={tested ? t('identityAdministration.validated') : undefined} loading={testing} disabled={saving || testing || providerDirty || revisionConflict || !props.mutationsAvailable} onPress={() => void testConfiguration()} showChevron={false} /> : null}
                <Item testID={props.saveTestId ?? `${props.testIdPrefix ?? 'identity-provider'}-save`} title={saving ? t('identityAdministration.saving') : t('identityAdministration.save')} loading={saving} disabled={saving || commitPending || revisionConflict || !dirty || !props.mutationsAvailable} onPress={() => save()} showChevron={false} />
            </ItemGroup>
        </>
    );
});

const HomeManagedOidcProviderEditorAdapter = React.memo(function HomeManagedOidcProviderEditorAdapter(props: Readonly<{
    context: HomeAdministrationContext;
    providerId?: string;
}>) {
    const router = useRouter();
    const providers = useManagedIdentityProviders(props.context.scope);
    const onSaved = React.useCallback((saved: ManagedIdentityProviderV1) => {
        router.replace(homeAdministrationIdentityProviderPath(props.context.scope.serverId, saved.id));
        return { kind: 'completed' } as const;
    }, [props.context.scope.serverId, router]);
    const provider = props.providerId && providers.state.kind === 'ready'
        ? providers.state.items.find((item) => item.id === props.providerId && item.kind === 'oidc') ?? null
        : null;
    if (props.providerId && providers.state.kind === 'unavailable') {
        return <ItemGroup footer={providers.state.failure.retryable ? t('teams.unavailable.offline') : t('identityAdministration.error')}><Item title={t('identityAdministration.error')} detail={providers.state.failure.retryable ? t('common.retry') : undefined} onPress={providers.state.failure.retryable ? providers.refresh : undefined} showChevron={false} /></ItemGroup>;
    }
    if (props.providerId && providers.state.kind === 'ready' && !provider) {
        return <ItemGroup><Item title={t('identityAdministration.error')} showChevron={false} /></ItemGroup>;
    }
    return <ManagedOidcProviderEditorContent
        scope={props.context.scope}
        owner={{ kind: 'home' }}
        provider={provider}
        loading={Boolean(props.providerId) && providers.state.kind === 'loading'}
        mutationsAvailable={props.context.mutationsAvailable}
        onApprovalPending={props.context.requestApproval}
        onRefreshRequested={providers.refresh}
        onSaved={onSaved}
    />;
});

export const ManagedIdentityProviderEditorScreen = React.memo(function ManagedIdentityProviderEditorScreen(props: Readonly<{
    serverId: string;
    providerId?: string;
}>) {
    return (
        <HomeAdministrationSection serverId={props.serverId} title={t(props.providerId ? 'identityAdministration.editTitle' : 'identityAdministration.createTitle')}>
            {(context) => context.projection.capabilities.manageAuthentication
                ? <HomeManagedOidcProviderEditorAdapter
                    key={`${serverAccountScopeKeySuffix(context.scope)}:${props.providerId ?? 'create'}`}
                    context={context}
                    providerId={props.providerId}
                />
                : <ItemGroup><Item title={t('homeGovernance.forbiddenTitle')} showChevron={false} /></ItemGroup>}
        </HomeAdministrationSection>
    );
});

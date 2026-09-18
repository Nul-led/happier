import * as React from 'react';
import type { PrincipalRefV1, SavedSecretCatalogAudienceV1 } from '@happier-dev/protocol';

import { sessionAccessSubjectKey } from '@/components/sessions/access/projectSessionAccessEditorSnapshot';
import type {
    SessionAccessCandidateRowModel,
    SessionAccessDirectoryKind,
    SessionAccessDirectorySectionModel,
    SessionAccessGrantOperationModel,
} from '@/components/sessions/access/sessionAccessEditorTypes';
import { useSessionAccessDirectory } from '@/components/sessions/access/useSessionAccessDirectory';
import { SelectionList, type SelectionListOption, type SelectionListSectionDescriptor, type SelectionListStep } from '@/components/ui/selectionList';
import { createDefaultDynamicSectionCache } from '@/components/ui/selectionList/selectionListDynamicSectionCache';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { t } from '@/text';

export type SavedSecretGrantDraft = Readonly<{
    accounts: ReadonlySet<string>;
    teams: ReadonlySet<string>;
    groups: ReadonlySet<string>;
}>;

const EMPTY_OPERATIONS: Readonly<Record<string, SessionAccessGrantOperationModel>> = Object.freeze({});

export function createEmptySavedSecretGrantDraft(): SavedSecretGrantDraft {
    return { accounts: new Set(), teams: new Set(), groups: new Set() };
}

function toggle(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
}

function togglePrincipal(draft: SavedSecretGrantDraft, principal: PrincipalRefV1): SavedSecretGrantDraft {
    switch (principal.kind) {
        case 'account': return { ...draft, accounts: toggle(draft.accounts, principal.accountId) };
        case 'team': return { ...draft, teams: toggle(draft.teams, principal.teamId) };
        case 'group': return { ...draft, groups: toggle(draft.groups, principal.groupId) };
    }
}

function candidateTestId(row: SessionAccessCandidateRowModel): string {
    const ref = row.principal.ref;
    switch (ref.kind) {
        case 'account': return `saved-secret-access-account:${ref.accountId}`;
        case 'team': return `saved-secret-access-team:${ref.teamId}`;
        case 'group': return `saved-secret-access-group:${ref.teamId}:${ref.groupId}`;
    }
}

function candidateOptions(input: Readonly<{
    rows: readonly SessionAccessCandidateRowModel[];
    retainedKeys: ReadonlySet<string>;
    disabled: boolean;
    onSelect: (principal: PrincipalRefV1) => void;
}>): SelectionListOption[] {
    return input.rows.flatMap((row) => {
        if (input.retainedKeys.has(row.principal.key)) return [];
        const blocked = row.addition.kind === 'blocked' ? row.addition.reason.message : undefined;
        return [{
            id: row.principal.key,
            testID: candidateTestId(row),
            label: row.principal.displayName,
            subtitle: [row.principal.secondaryLabel, blocked].filter(Boolean).join(' · ') || undefined,
            accessibilityLabel: row.principal.accessibilityLabel,
            disabled: input.disabled || row.addition.kind === 'blocked' || row.operation.kind === 'saving',
            loading: row.operation.kind === 'saving',
            onSelect: () => input.onSelect(row.principal.ref),
        }];
    });
}

function directorySection(input: Readonly<{
    source: SessionAccessDirectorySectionModel;
    retainedKeys: ReadonlySet<string>;
    disabled: boolean;
    onSelect: (principal: PrincipalRefV1) => void;
}>): SelectionListSectionDescriptor {
    const { source } = input;
    return {
        kind: 'dynamic',
        id: `saved-secret-directory:${source.kind}`,
        title: source.title,
        resolverKey: source.resolverKey ?? source.kind,
        resultFiltering: 'provider',
        resultTransition: 'none',
        showSkeletonsOnFirstLoad: true,
        resolve: async (query, signal) => ({
            options: candidateOptions({
                ...input,
                rows: source.resolveCandidates
                    ? await source.resolveCandidates(query, signal)
                    : source.candidates,
            }),
        }),
    };
}

function directoryControls(
    source: SessionAccessDirectorySectionModel,
    retry: (kind: SessionAccessDirectoryKind) => void,
    browseStep?: SelectionListStep,
): SelectionListSectionDescriptor | null {
    const options: SelectionListOption[] = [];
    if (source.status === 'error' && source.error) options.push({
        id: `retry:${source.kind}`,
        label: source.error.message,
        subtitle: t('common.retry'),
        testID: `saved-secret-access-directory-retry:${source.kind}`,
        onSelect: () => retry(source.kind),
    });
    if (source.hasMore && browseStep) options.push({
        id: `browse:${source.kind}`,
        label: source.title,
        subtitle: t('session.access.browseMore'),
        testID: `saved-secret-access-directory-browse:${source.kind}`,
        openStep: browseStep,
    });
    return options.length > 0 ? { kind: 'static', id: `directory-controls:${source.kind}`, options } : null;
}

function retainedPrincipalKeys(audience: SavedSecretCatalogAudienceV1 | undefined): ReadonlySet<string> {
    if (!audience) return new Set();
    return new Set([
        ...audience.accounts.map((account) => `account:${account.accountId}`),
        ...audience.teams.map((team) => `team:${team.teamId}`),
        ...audience.groups.map((group) => `group:${group.teamId}:${group.groupId}`),
    ]);
}

function retainedOptions(
    audience: SavedSecretCatalogAudienceV1 | undefined,
    disabled: boolean,
    onSelect: (principal: PrincipalRefV1) => void,
): SelectionListOption[] {
    if (!audience) return [];
    return [
        ...audience.accounts.map((account): SelectionListOption => ({
            id: `account:${account.accountId}`,
            testID: `saved-secret-access-account:${account.accountId}`,
            label: formatAccountDisplayName(account) ?? account.accountId,
            accessibilityLabel: formatAccountDisplayName(account) ?? account.accountId,
            disabled,
            onSelect: () => onSelect({ kind: 'account', accountId: account.accountId }),
        })),
        ...audience.teams.map((team): SelectionListOption => ({
            id: `team:${team.teamId}`,
            testID: `saved-secret-access-team:${team.teamId}`,
            label: team.name,
            disabled,
            onSelect: () => onSelect({ kind: 'team', teamId: team.teamId }),
        })),
        ...audience.groups.map((group): SelectionListOption => ({
            id: `group:${group.teamId}:${group.groupId}`,
            testID: `saved-secret-access-group:${group.teamId}:${group.groupId}`,
            label: group.name,
            subtitle: group.teamName,
            disabled,
            onSelect: () => onSelect({ kind: 'group', teamId: group.teamId, groupId: group.groupId }),
        })),
    ];
}

/** Canonical Account/Team/Group composition shared by create and access edit. */
export const SavedSecretGrantPicker = React.memo(function SavedSecretGrantPicker(props: Readonly<{
    scope: ServerAccountScope;
    draft: SavedSecretGrantDraft;
    onChange: (draft: SavedSecretGrantDraft) => void;
    disabled?: boolean;
    retainedAudience?: SavedSecretCatalogAudienceV1;
}>) {
    const [query, setQuery] = React.useState('');
    const [directoryKind, setDirectoryKind] = React.useState<SessionAccessDirectoryKind | undefined>();
    const [dynamicSectionCache] = React.useState(createDefaultDynamicSectionCache);
    const selectedGroupTeams = React.useRef(new Map(
        props.retainedAudience?.groups.map((group) => [group.groupId, group.teamId]) ?? [],
    ));
    const directory = useSessionAccessDirectory({
        scope: props.scope,
        availability: 'full_collaboration',
        contextTeams: [],
        operations: EMPTY_OPERATIONS,
        revision: 0,
        enabled: true,
    });
    const retainedKeys = React.useMemo(() => retainedPrincipalKeys(props.retainedAudience), [props.retainedAudience]);
    const selectedKeys = React.useMemo(() => new Set([
        ...[...props.draft.accounts].map((accountId) => sessionAccessSubjectKey({ kind: 'account', accountId })),
        ...[...props.draft.teams].map((teamId) => sessionAccessSubjectKey({ kind: 'team', teamId })),
        ...[...props.draft.groups].flatMap((groupId) => {
            const teamId = selectedGroupTeams.current.get(groupId);
            return teamId ? [sessionAccessSubjectKey({ kind: 'group', teamId, groupId })] : [];
        }),
    ]), [props.draft]);
    // Directory rows are resolved once and cached by the selection list, so the
    // handler they captured outlives the draft that produced it. Reading the
    // current draft through a ref keeps every later choice additive; closing
    // over the draft made each press discard the choices before it.
    const draftRef = React.useRef(props.draft);
    draftRef.current = props.draft;
    const toggleSelection = React.useCallback((principal: PrincipalRefV1) => {
        if (principal.kind === 'group') selectedGroupTeams.current.set(principal.groupId, principal.teamId);
        props.onChange(togglePrincipal(draftRef.current, principal));
    }, [props.onChange]);

    React.useEffect(() => {
        setQuery('');
        setDirectoryKind(undefined);
        selectedGroupTeams.current = new Map(
            props.retainedAudience?.groups.map((group) => [group.groupId, group.teamId]) ?? [],
        );
    }, [props.retainedAudience?.groups, props.scope.accountId, props.scope.serverId]);

    const buildKindStep = (source: SessionAccessDirectorySectionModel): SelectionListStep => {
        const controls = directoryControls(source, directory.retry);
        return {
            id: `saved-secret-directory-step:${source.kind}`,
            title: source.title,
            inputPlaceholder: t('session.access.search'),
            inputReadOnly: props.disabled,
            disableInputFilter: true,
            emptyStateLabel: t('common.noMatches'),
            sections: [
                directorySection({ source, retainedKeys, disabled: props.disabled ?? false, onSelect: toggleSelection }),
                ...(controls ? [controls] : []),
            ],
        };
    };
    const rootSections: SelectionListSectionDescriptor[] = [];
    const current = retainedOptions(props.retainedAudience, props.disabled ?? false, toggleSelection);
    if (current.length > 0) rootSections.push({
        kind: 'static', id: 'current', title: t('session.access.hasAccess'), options: current,
    });
    for (const source of directory.sections) {
        rootSections.push(directorySection({ source, retainedKeys, disabled: props.disabled ?? false, onSelect: toggleSelection }));
        const controls = directoryControls(source, directory.retry, buildKindStep(source));
        if (controls) rootSections.push(controls);
    }
    const rootStep: SelectionListStep = {
        id: 'saved-secret-grants',
        inputPlaceholder: t('session.access.search'),
        inputReadOnly: props.disabled,
        disableInputFilter: true,
        emptyStateLabel: t('common.noMatches'),
        sections: rootSections,
    };
    const activeSource = directoryKind && directory.sections.find((source) => source.kind === directoryKind);
    const activeStep = activeSource ? buildKindStep(activeSource) : null;

    return <SelectionList
        rootStep={rootStep}
        syncActiveStep={activeStep}
        onActiveStepChange={(step) => {
            setDirectoryKind(directory.sections.find((source) => step.id === `saved-secret-directory-step:${source.kind}`)?.kind);
        }}
        inputValue={query}
        onChangeInputValue={setQuery}
        inputTestID="saved-secret-access-account-search"
        selection={{ kind: 'multiple', selectedIds: selectedKeys }}
        onSelect={() => {}}
        onRequestClose={() => {}}
        dynamicSectionCache={dynamicSectionCache}
        listAccessibilityLabel={t('secrets.catalog.actions.manageAccess')}
        testID="saved-secret-access-directory"
        autoFocusInputOnNative={false}
        fillAvailableSpace={false}
        heightBehavior="content"
        pagination={activeSource ? {
            hasMore: activeSource.hasMore,
            loadingMore: activeSource.loadingMore,
            requestKey: activeSource.cursor,
            error: activeSource.error?.message,
            onEndReached: () => directory.loadMore(activeSource.kind),
            onRetry: () => directory.retry(activeSource.kind),
            loadingLabel: t('common.loading'),
            moreLabel: t('session.access.browseMore'),
            retryLabel: t('common.retry'),
            endReachedLabel: t('session.access.allLoaded'),
        } : undefined}
    />;
});

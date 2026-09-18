import * as React from 'react';
import type { PrincipalRefV1, SessionInitialAccessDraftV1 } from '@happier-dev/protocol';

import type { SessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { t } from '@/text';

import { projectSessionAccessChipSummary } from './projectSessionAccessChipSummary';
import { projectSessionAccessContextChange } from './projectSessionAccessContextChange';
import { sessionAccessGrantMutation } from './sessionAccessGrantMutation';
import { projectSessionAccessDelegationControl, sessionAccessSubjectKey } from './projectSessionAccessEditorSnapshot';
import { useSessionAccessDirectory, type SessionAccessDirectoryTeamContext } from './useSessionAccessDirectory';
import type {
    SessionAccessEditorActions,
    SessionAccessEditorController,
    SessionAccessGrantRowModel,
    SessionAccessLevel,
    SessionAccessPrincipalPresentation,
} from './sessionAccessEditorTypes';

const ACCESS_LEVEL_OPTIONS: readonly SessionAccessLevel[] = ['view', 'edit', 'admin'];

function principalKindLabel(subject: PrincipalRefV1): string {
    return subject.kind === 'account' ? t('session.access.account')
        : subject.kind === 'team' ? t('session.access.team') : t('session.access.group');
}

/**
 * The New Session access draft, edited entirely in the synchronized creation
 * document.
 *
 * It shares the exact editor component, row projector and directory sources
 * with the live controller and differs only in where a change lands: a draft
 * row is local, so adding, changing and removing are immediate and need no
 * acknowledgement, and the value travels to the server once — as the canonical
 * `initialAccess` of the fresh-create transaction. It issues no grant mutation,
 * writes no Follow, read or notification state, and applies no Team policy: the
 * creating transaction revalidates every subject, level and delegation.
 */
export function useNewSessionAccessDraftController(input: Readonly<{
    scope: ServerAccountScope;
    access: SessionInitialAccessDraftV1 | null;
    primaryTeamId: string | null;
    availability: SessionCollaborationAvailability;
    homeReconciled?: boolean;
    onChange: (next: SessionInitialAccessDraftV1 | null) => void;
    onPrimaryTeamIdChange: (next: string | null) => void;
}>): SessionAccessEditorController {
    const { access, availability, onChange, onPrimaryTeamIdChange, primaryTeamId, scope } = input;
    const [query, setQuery] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const [pendingContextTeamId, setPendingContextTeamId] = React.useState<string | null | undefined>(undefined);
    const [explainedReason, setExplainedReason] = React.useState<Readonly<{ code: string; message: string }> | null>(null);
    // Display names come from the candidate row the person actually chose. A
    // restored draft has only Home-local identifiers, so its rows stay labelled
    // by kind rather than inventing a name for an identifier.
    const [names, setNames] = React.useState<Readonly<Record<string, SessionAccessPrincipalPresentation>>>({});
    const grants = React.useMemo(() => access?.grants ?? [], [access]);
    const grantsRef = React.useRef(grants);
    grantsRef.current = grants;

    // Only the current collaboration vertical can carry a creation access draft
    // atomically; an older Home would create the Session first and share after.
    const editable = availability === 'full_collaboration';

    const publish = React.useCallback((next: readonly SessionInitialAccessDraftV1['grants'][number][]) => {
        onChange(next.length === 0 ? null : { grants: [...next] });
    }, [onChange]);

    const contextTeams = React.useMemo<readonly SessionAccessDirectoryTeamContext[]>(() => grants
        .filter((grant) => grant.subject.kind === 'team')
        .map((grant) => ({ teamId: grant.subject.kind === 'team' ? grant.subject.teamId : '', name: names[sessionAccessSubjectKey(grant.subject)]?.displayName ?? t('session.access.team') })), [grants, names]);

    const directory = useSessionAccessDirectory({
        scope, availability, contextTeams, operations: {}, revision, enabled: editable,
    });
    const directoryTeamsRef = React.useRef(directory.teamContexts);
    directoryTeamsRef.current = directory.teamContexts;
    const primaryTeamPolicy = primaryTeamId === null
        ? null
        : directory.teamContexts.find((team) => team.teamId === primaryTeamId) ?? null;
    const primaryTeamPolicyUnavailable = primaryTeamId !== null && primaryTeamPolicy === null;

    const rows = React.useMemo<readonly SessionAccessGrantRowModel[]>(() => grants.map((grant) => {
        const key = sessionAccessSubjectKey(grant.subject);
        const requiredByTeamPolicy = grant.subject.kind === 'team'
            && grant.subject.teamId === primaryTeamId
            && primaryTeamPolicy?.sessionCreationPolicy === 'team_required';
        const principal = names[key] ?? {
            ref: grant.subject,
            key,
            displayName: principalKindLabel(grant.subject),
            accessibilityLabel: principalKindLabel(grant.subject),
        };
        return {
            grant: grant.subject,
            principal,
            level: editable
                ? { kind: 'editable', value: grant.accessLevel, options: ACCESS_LEVEL_OPTIONS
                    .filter((value) => !requiredByTeamPolicy || value !== 'view')
                    .map((value) => ({ value, label: t(`session.access.${value}`) })) }
                : { kind: 'locked', value: grant.accessLevel, reason: { code: 'session_access_update_required', message: t('session.access.updateRequired') } },
            permissionDelegation: projectSessionAccessDelegationControl({
                accessLevel: grant.accessLevel,
                canApprovePermissions: grant.canApprovePermissions,
                canChange: editable,
                reason: { code: 'session_access_update_required', message: t('session.access.updateRequired') },
            }),
            removal: requiredByTeamPolicy
                ? { kind: 'blocked', reason: { code: 'session_access_team_policy_required', message: t('session.access.required') } }
                : editable
                ? { kind: 'allowed' }
                : { kind: 'blocked', reason: { code: 'session_access_update_required', message: t('session.access.updateRequired') } },
            requiredByTeamPolicy,
            operation: { kind: 'idle' },
        };
    }), [editable, grants, names, primaryTeamId, primaryTeamPolicy?.sessionCreationPolicy]);

    const replace = React.useCallback((subject: PrincipalRefV1, next: SessionInitialAccessDraftV1['grants'][number] | null) => {
        if (!editable) return;
        if (subject.kind === 'team' && subject.teamId === primaryTeamId
            && directoryTeamsRef.current.find((team) => team.teamId === subject.teamId)?.sessionCreationPolicy === 'team_required'
            && (next === null || next.accessLevel === 'view')) return;
        const key = sessionAccessSubjectKey(subject);
        const current = grantsRef.current;
        const index = current.findIndex((grant) => sessionAccessSubjectKey(grant.subject) === key);
        if (next === null) {
            if (index < 0) return;
            publish(current.filter((_, position) => position !== index));
            return;
        }
        publish(index < 0 ? [...current, next] : current.map((grant, position) => (position === index ? next : grant)));
    }, [editable, primaryTeamId, publish]);

    /**
     * The one place a Team-policy floor is derived, for every route into a Team
     * context: a reviewed context change, a restored draft, and the Team
     * credential's visibility requirement all land here instead of seeding their
     * own grant at their own level.
     *
     * Both Team-context policies start from the same collaborative V1 proposal —
     * Edit with no delegation. Only `team_required` is enforced whenever its
     * policy is known; `team_default` merely proposes its row when this editor
     * actually enters the context, so a later removal stays the creator's
     * explicit private override and survives normal draft restoration.
     */
    const enteredContextTeamId = React.useRef(primaryTeamId);
    const contextCreationPolicy = primaryTeamPolicy?.sessionCreationPolicy;
    React.useEffect(() => {
        const entering = enteredContextTeamId.current !== primaryTeamId;
        if (primaryTeamId === null) enteredContextTeamId.current = null;
        else if (contextCreationPolicy) enteredContextTeamId.current = primaryTeamId;
        if (!editable || primaryTeamId === null) return;
        if (contextCreationPolicy !== 'team_required'
            && !(entering && contextCreationPolicy === 'team_default')) return;
        const subject = { kind: 'team' as const, teamId: primaryTeamId };
        const existing = grantsRef.current.find((grant) => sessionAccessSubjectKey(grant.subject) === sessionAccessSubjectKey(subject));
        if (existing && existing.accessLevel !== 'view') return;
        replace(subject, sessionAccessGrantMutation(subject, { accessLevel: 'edit', canApprovePermissions: false }));
    }, [contextCreationPolicy, editable, primaryTeamId, replace]);

    const submitContext = React.useCallback((teamId: string | null) => {
        const target = teamId === null ? null : directoryTeamsRef.current.find((team) => team.teamId === teamId) ?? null;
        if (teamId !== null && (!target?.sessionCreationPolicy || !target.externalSharingPolicy)) return;
        onPrimaryTeamIdChange(teamId);
        setPendingContextTeamId(undefined);
    }, [onPrimaryTeamIdChange]);

    const setContext = React.useCallback((teamId: string | null) => {
        if (!editable || primaryTeamId === teamId) return;
        if (primaryTeamPolicy?.sessionCreationPolicy === 'team_required') return;
        const target = teamId === null ? null : directoryTeamsRef.current.find((team) => team.teamId === teamId) ?? null;
        if (teamId !== null && (!target?.sessionCreationPolicy || !target.externalSharingPolicy)) return;
        const current = primaryTeamId === null ? null : directoryTeamsRef.current.find((team) => team.teamId === primaryTeamId) ?? null;
        if (primaryTeamId !== null && !current) return;
        const consequences = projectSessionAccessContextChange({ target, current, grants: grantsRef.current });
        if (consequences.length > 0) {
            setPendingContextTeamId(teamId);
            return;
        }
        submitContext(teamId);
    }, [editable, primaryTeamId, primaryTeamPolicy?.sessionCreationPolicy, submitContext]);

    const actions = React.useMemo<SessionAccessEditorActions>(() => ({
        setQuery,
        retryContent: () => setRevision((value) => value + 1),
        retryDirectory: (kind) => { directory.retry(kind); setRevision((value) => value + 1); },
        loadMore: (kind) => directory.loadMore(kind),
        addPrincipal: (subject) => {
            // Candidate additions use the neutral direct-share default. A
            // primary-Team required floor is composed only by the reviewed
            // context transition below from that Team's server projection.
            replace(subject, sessionAccessGrantMutation(subject, { accessLevel: 'view', canApprovePermissions: false }));
            setQuery('');
        },
        setAccessLevel: (subject, level) => {
            const existing = grantsRef.current.find((grant) => sessionAccessSubjectKey(grant.subject) === sessionAccessSubjectKey(subject));
            if (!existing) return;
            replace(subject, sessionAccessGrantMutation(subject, { accessLevel: level, canApprovePermissions: level === 'view' ? false : existing.canApprovePermissions }));
        },
        setPermissionDelegation: (subject, enabled) => {
            const existing = grantsRef.current.find((grant) => sessionAccessSubjectKey(grant.subject) === sessionAccessSubjectKey(subject));
            if (!existing || existing.accessLevel === 'view') return;
            replace(subject, sessionAccessGrantMutation(subject, { accessLevel: existing.accessLevel, canApprovePermissions: enabled }));
        },
        // A draft principal has never been granted anything, so removing it is
        // immediate and confirmation would be ceremony without consequence.
        requestRemove: (subject) => replace(subject, null),
        confirmRemove: (subject) => replace(subject, null),
        cancelRemove: () => {},
        explain: setExplainedReason,
        setContext,
        confirmContext: () => { if (pendingContextTeamId !== undefined) submitContext(pendingContextTeamId); },
        cancelContext: () => setPendingContextTeamId(undefined),
        clearAccess: () => {
            onChange(null);
            onPrimaryTeamIdChange(null);
        },
        // A draft has no committed audience yet: there is nothing to prepare or inspect
        // until the Session and its grants exist.
        prepareAccess: () => {},
        toggleAllRecipients: () => {},
        loadMoreRecipients: () => {},
    }), [directory, pendingContextTeamId, replace, setContext, submitContext]);

    // Candidate presentation is captured as it is chosen so the selected row
    // keeps its real name without a second identity lookup.
    const sections = React.useMemo(() => directory.sections.map((section) => ({
        ...section,
        ...(section.resolveCandidates ? {
            resolveCandidates: async (search: string, signal: AbortSignal) => {
                const candidates = await section.resolveCandidates!(search, signal);
                setNames((current) => {
                    // Copy-on-first-change: unchanged names keep their identity so the
                    // rows around them are not rebuilt by a search that found nothing new.
                    let next: Record<string, SessionAccessPrincipalPresentation> | null = null;
                    for (const candidate of candidates) {
                        if ((next ?? current)[candidate.principal.key] === candidate.principal) continue;
                        next ??= { ...current };
                        next[candidate.principal.key] = candidate.principal;
                    }
                    return next ?? current;
                });
                return candidates;
            },
        } : {}),
    })), [directory.sections]);

    return {
        actions,
        model: {
            revision,
            accessMode: editable ? 'editable' : 'read_only',
            ...(editable ? {} : { readOnlyReason: { code: 'session_access_update_required', message: t('session.access.updateRequired') } }),
            content: { phase: 'ready', hasLastAcknowledgedSnapshot: true },
            owner: null,
            grants: rows,
            directory: { query, sections },
            summary: projectSessionAccessChipSummary({ grants: rows, audienceComplete: true }),
            context: {
                primaryTeamId,
                options: [
                    { teamId: null, label: t('session.access.private'),
                        ...(primaryTeamPolicy?.sessionCreationPolicy === 'team_required' ? { blockedReason: {
                            code: 'session_access_team_policy_required', message: t('session.access.required'),
                        } } : primaryTeamPolicyUnavailable ? { blockedReason: {
                            code: 'session_access_context_policy_unavailable', message: t('errors.operationFailed'),
                        } } : {}) },
                    ...directory.teamContexts.map((team) => ({ teamId: team.teamId, label: team.name,
                        ...(primaryTeamPolicy?.sessionCreationPolicy === 'team_required' && team.teamId !== primaryTeamId
                            ? { blockedReason: { code: 'session_access_team_policy_required', message: t('session.access.required') } }
                            : !team.sessionCreationPolicy || !team.externalSharingPolicy || primaryTeamPolicyUnavailable ? { blockedReason: {
                            code: 'session_access_context_policy_unavailable', message: t('errors.operationFailed'),
                        } } : {}),
                    })),
                ],
                ...(pendingContextTeamId !== undefined ? { confirmation: {
                    teamId: pendingContextTeamId,
                    label: pendingContextTeamId === null ? t('session.access.private')
                        : directory.teamContexts.find((team) => team.teamId === pendingContextTeamId)?.name ?? t('session.access.team'),
                    consequences: projectSessionAccessContextChange({
                        target: pendingContextTeamId === null ? null : directory.teamContexts.find((team) => team.teamId === pendingContextTeamId) ?? null,
                        current: primaryTeamPolicy,
                        grants,
                    }),
                } } : {}),
            },
            ...(explainedReason
                ? { notice: { message: explainedReason.message, reason: explainedReason } }
                : input.homeReconciled
                    ? { notice: { message: t('session.access.homeReconciled'), reason: {
                        code: 'session_access_home_reconciled', message: t('session.access.homeReconciled'),
                    } } }
                : editable || grants.length === 0
                    ? {}
                    : { notice: { message: t('session.access.updateRequired'), action: 'clear_access' as const } }),
        },
    };
}

import * as React from 'react';
import type {
    TeamCredentialResourceSummaryV1,
    TeamCredentialUsageCapabilitiesV1,
} from '@happier-dev/protocol/teams';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { TextInput } from '@/components/ui/text/Text';
import { t } from '@/text';

import type { TeamSectionContext } from '../teamSectionContext';
import {
    limitMetricLabel,
    limitPeriodLabel,
    limitSubjectKindLabel,
    resourceDirectExposure,
} from './teamCredentialPresentation';
import { TeamCredentialAudiencePicker } from './TeamCredentialAudiencePicker';
import {
    EMPTY_TEAM_CREDENTIAL_LIMIT_DRAFT,
    TEAM_CREDENTIAL_LIMIT_PERIODS,
    TEAM_CREDENTIAL_LIMIT_SUBJECT_KINDS,
    availableTeamCredentialLimitMetrics,
    teamCredentialLimitMaximumValid,
    teamCredentialLimitSubjectSelected,
    type TeamCredentialLimitDraft,
    type TeamCredentialResourceDraft,
} from './teamCredentialEditorDraft';

function rowKey(limit: TeamCredentialLimitDraft, index: number): string {
    return limit.id ?? `new-${index}`;
}

export const TeamCredentialLimitsEditorSection = React.memo(function TeamCredentialLimitsEditorSection(props: Readonly<{
    context: TeamSectionContext;
    resource: TeamCredentialResourceSummaryV1 | null;
    usageCapabilities: TeamCredentialUsageCapabilitiesV1 | undefined;
    draft: TeamCredentialResourceDraft;
    busy: boolean;
    onRequestDraftChange: (nextDraft: TeamCredentialResourceDraft) => void;
}>) {
    const { context, resource, usageCapabilities, draft, busy, onRequestDraftChange } = props;
    const [editor, setEditor] = React.useState<Readonly<{ kind: 'add' } | { kind: 'edit'; index: number }> | null>(null);
    const [pickedSubjectName, setPickedSubjectName] = React.useState<string | null>(null);
    const [pickedSubjectMembershipId, setPickedSubjectMembershipId] = React.useState<string | null>(null);
    const targetKey = `${context.scope.serverId}:${context.scope.accountId}:${context.address.teamId}:${resource?.id ?? 'new'}`;
    const metrics = availableTeamCredentialLimitMetrics(usageCapabilities);

    React.useEffect(() => {
        setEditor(null);
        setPickedSubjectName(null);
        setPickedSubjectMembershipId(null);
    }, [targetKey]);

    const requestPendingChange = (pendingLimit: TeamCredentialLimitDraft) => {
        onRequestDraftChange({ ...draft, pendingLimit });
    };
    const closeEditor = () => {
        setEditor(null);
        setPickedSubjectName(null);
        setPickedSubjectMembershipId(null);
    };
    const exposure = resource === null ? null : resourceDirectExposure(resource);
    const deliveryNote = exposure === 'only'
        ? t('teams.credentials.limits.directOnly')
        : exposure === 'some'
            ? t('teams.credentials.limits.directNote')
            : null;

    return (
        <>
            <ItemGroup
                title={t('teams.credentials.limits.title')}
                footer={[t('teams.credentials.limits.overshoot'), deliveryNote]
                    .filter((part): part is string => part !== null)
                    .join('\n')}
            >
                {draft.limits.length === 0 ? (
                    <Item
                        testID="team-credential-limits-empty"
                        title={t('teams.credentials.limits.empty')}
                        showChevron={false}
                    />
                ) : draft.limits.map((limit, index) => {
                    const key = rowKey(limit, index);
                    return (
                        <React.Fragment key={key}>
                            <Item
                                testID={`team-credential-limit-edit:${key}`}
                                title={limitSubjectKindLabel(limit.subjectKind)}
                                subtitle={`${limitMetricLabel(limit.metric)} · ${limitPeriodLabel(limit.period)} · ${limit.maximum}`}
                                detail={!limit.enabled ? t('teams.credentials.limits.disabled') : undefined}
                                disabled={busy}
                                onPress={() => {
                                    requestPendingChange(limit);
                                    setPickedSubjectName(null);
                                    setPickedSubjectMembershipId(null);
                                    setEditor({ kind: 'edit', index });
                                }}
                                showChevron={false}
                            />
                            <Item
                                testID={`team-credential-limit-remove:${key}`}
                                title={t('teams.credentials.limits.remove')}
                                destructive
                                disabled={busy}
                                onPress={() => {
                                    const limits = draft.limits.filter((_, candidateIndex) => candidateIndex !== index);
                                    const closesCurrent = editor?.kind === 'edit' && editor.index === index;
                                    onRequestDraftChange({
                                        ...draft,
                                        limits,
                                        ...(closesCurrent ? { pendingLimit: EMPTY_TEAM_CREDENTIAL_LIMIT_DRAFT } : {}),
                                    });
                                    if (closesCurrent) closeEditor();
                                }}
                                showChevron={false}
                            />
                        </React.Fragment>
                    );
                })}
            </ItemGroup>

            {editor === null ? (
                <ItemGroup>
                    <Item
                        testID="team-credential-limit-add"
                        title={t('teams.credentials.limits.add')}
                        disabled={busy || metrics.length === 0}
                        onPress={() => {
                            requestPendingChange(EMPTY_TEAM_CREDENTIAL_LIMIT_DRAFT);
                            setPickedSubjectName(null);
                            setPickedSubjectMembershipId(null);
                            setEditor({ kind: 'add' });
                        }}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : (
                <>
                    <ItemGroup
                        title={t('teams.credentials.limits.subjectLabel')}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('teams.credentials.limits.subjectLabel')}
                    >
                        {TEAM_CREDENTIAL_LIMIT_SUBJECT_KINDS.map((kind) => (
                            <Item
                                key={kind}
                                testID={`team-credential-limit-subject:${kind}`}
                                title={limitSubjectKindLabel(kind)}
                                selected={draft.pendingLimit.subjectKind === kind}
                                disabled={busy}
                                onPress={() => {
                                    setPickedSubjectName(null);
                                    setPickedSubjectMembershipId(null);
                                    requestPendingChange({ ...draft.pendingLimit, subjectKind: kind, subjectId: '' });
                                }}
                                showChevron={false}
                            />
                        ))}
                    </ItemGroup>

                    {draft.pendingLimit.subjectKind === 'team_group' ? (
                        <ItemGroup title={t('teams.credentials.limits.subject.group')}>
                            {draft.pendingLimit.subjectId ? (
                                <Item
                                    testID={`team-credential-limit-group:${draft.pendingLimit.subjectId}`}
                                    title={pickedSubjectName ?? t('teams.credentials.limits.unknownSubject')}
                                    selected
                                    showChevron={false}
                                />
                            ) : null}
                            <TeamCredentialAudiencePicker
                                testID="team-credential-limit-group-choose"
                                scope={context.scope}
                                address={context.address}
                                excludedGroupIds={draft.pendingLimit.subjectId ? [draft.pendingLimit.subjectId] : []}
                                excludedMemberIds={[]}
                                allowedKinds={['group']}
                                label={t('teams.credentials.limits.subject.group')}
                                disabled={busy}
                                onChoose={(principal) => {
                                    if (principal.kind !== 'group') return;
                                    setPickedSubjectName(principal.name);
                                    requestPendingChange({ ...draft.pendingLimit, subjectId: principal.id });
                                }}
                            />
                        </ItemGroup>
                    ) : null}

                    {draft.pendingLimit.subjectKind === 'team_member' ? (
                        <ItemGroup title={t('teams.credentials.limits.subject.member')}>
                            {draft.pendingLimit.subjectId ? (
                                <Item
                                    testID={`team-credential-limit-member-account:${draft.pendingLimit.subjectId}`}
                                    title={pickedSubjectName ?? t('teams.credentials.limits.unknownSubject')}
                                    selected
                                    showChevron={false}
                                />
                            ) : null}
                            <TeamCredentialAudiencePicker
                                testID="team-credential-limit-member-choose"
                                scope={context.scope}
                                address={context.address}
                                excludedGroupIds={[]}
                                excludedMemberIds={pickedSubjectMembershipId ? [pickedSubjectMembershipId] : []}
                                allowedKinds={['member']}
                                label={t('teams.credentials.limits.subject.member')}
                                disabled={busy}
                                onChoose={(principal) => {
                                    if (principal.kind !== 'member') return;
                                    setPickedSubjectName(principal.name);
                                    setPickedSubjectMembershipId(principal.id);
                                    requestPendingChange({ ...draft.pendingLimit, subjectId: principal.accountId });
                                }}
                            />
                        </ItemGroup>
                    ) : null}

                    <ItemGroup
                        title={t('teams.credentials.limits.metricLabel')}
                        footer={draft.pendingLimit.metric === 'cost_usd'
                            ? t('teams.credentials.limits.costNote')
                            : undefined}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('teams.credentials.limits.metricLabel')}
                    >
                        {metrics.map((metric) => (
                            <Item
                                key={metric}
                                testID={`team-credential-limit-metric:${metric}`}
                                title={limitMetricLabel(metric)}
                                selected={draft.pendingLimit.metric === metric}
                                disabled={busy}
                                onPress={() => requestPendingChange({ ...draft.pendingLimit, metric })}
                                showChevron={false}
                            />
                        ))}
                    </ItemGroup>

                    <ItemGroup
                        title={t('teams.credentials.limits.periodLabel')}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('teams.credentials.limits.periodLabel')}
                    >
                        {TEAM_CREDENTIAL_LIMIT_PERIODS.map((period) => (
                            <Item
                                key={period}
                                testID={`team-credential-limit-period:${period}`}
                                title={limitPeriodLabel(period)}
                                selected={draft.pendingLimit.period === period}
                                disabled={busy}
                                onPress={() => requestPendingChange({ ...draft.pendingLimit, period })}
                                showChevron={false}
                            />
                        ))}
                    </ItemGroup>

                    <ItemGroup
                        title={t('teams.credentials.limits.maximumLabel')}
                        footer={draft.pendingLimit.maximum.trim() !== '' && !teamCredentialLimitMaximumValid(draft.pendingLimit)
                            ? (draft.pendingLimit.metric === 'cost_usd'
                                ? t('teams.credentials.limits.maximumInvalidCost')
                                : t('teams.credentials.limits.maximumInvalid'))
                            : t('teams.credentials.limits.overshoot')}
                    >
                        <TextInput
                            testID="team-credential-limit-maximum"
                            value={draft.pendingLimit.maximum}
                            onChangeText={(maximum) => requestPendingChange({ ...draft.pendingLimit, maximum })}
                            placeholder={t('teams.credentials.limits.maximumPlaceholder')}
                            accessibilityLabel={t('teams.credentials.limits.maximumLabel')}
                            keyboardType="numeric"
                            editable={!busy}
                        />
                    </ItemGroup>

                    <ItemGroup>
                        <Item
                            testID="team-credential-limit-save"
                            title={editor.kind === 'add'
                                ? t('teams.credentials.limits.add')
                                : t('common.save')}
                            disabled={busy
                                || !metrics.includes(draft.pendingLimit.metric)
                                || !teamCredentialLimitMaximumValid(draft.pendingLimit)
                                || !teamCredentialLimitSubjectSelected(draft.pendingLimit)}
                            onPress={() => {
                                if (busy
                                    || !metrics.includes(draft.pendingLimit.metric)
                                    || !teamCredentialLimitMaximumValid(draft.pendingLimit)
                                    || !teamCredentialLimitSubjectSelected(draft.pendingLimit)) return;
                                const nextLimit = {
                                    ...draft.pendingLimit,
                                    subjectId: draft.pendingLimit.subjectKind === 'team_group'
                                        || draft.pendingLimit.subjectKind === 'team_member'
                                        ? draft.pendingLimit.subjectId
                                        : '',
                                };
                                const limits = editor.kind === 'add'
                                    ? [...draft.limits, nextLimit]
                                    : draft.limits.map((limit, index) => index === editor.index ? nextLimit : limit);
                                onRequestDraftChange({
                                    ...draft,
                                    limits,
                                    pendingLimit: EMPTY_TEAM_CREDENTIAL_LIMIT_DRAFT,
                                });
                                closeEditor();
                            }}
                            showChevron={false}
                        />
                        <Item
                            testID="team-credential-limit-cancel"
                            title={t('common.cancel')}
                            disabled={busy}
                            onPress={() => {
                                onRequestDraftChange({ ...draft, pendingLimit: EMPTY_TEAM_CREDENTIAL_LIMIT_DRAFT });
                                closeEditor();
                            }}
                            showChevron={false}
                        />
                    </ItemGroup>
                </>
            )}
        </>
    );
});

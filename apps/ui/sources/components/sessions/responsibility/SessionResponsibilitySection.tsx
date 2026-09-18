import * as React from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text } from '@/components/ui/text/Text';
import { SelectionListSkeletonRow } from '@/components/ui/selectionList/SelectionListSkeletonRow';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useUnistyles } from 'react-native-unistyles';

import { formatSessionResponsibilityName } from './formatSessionResponsibilityName';
import type { SessionResponsibilityController } from './useSessionResponsibilityController';
import type { SessionResponsibilityPickerHost } from './useSessionResponsibilityPickerHost';

/**
 * The one Responsibility section rendered inside the shared Collaboration
 * surface, on every responsive host that composes it.
 *
 * It is a quiet, text-led row: one avatar, one name, one chevron when the
 * viewer may change it. There is no second header control, no composer chip and
 * no card-inside-card treatment, because responsibility is a small workflow fact
 * beside access, not a feature of its own.
 *
 * One mounted controller owns candidate and mutation state; the surrounding
 * Collaboration surface creates it together with the picker host and hands both
 * to this row, because the compact host presents its step in place of that
 * surface's body rather than inside this section. The picker host owns only
 * which existing responsive selection host renders that shared model — the wide
 * anchored step or the compact pushed step — and it is bound to the surface's
 * exact `{serverId, accountId, sessionId}` target. The safe current assignee
 * comes from the canonical Session projection/Action response and stays visible
 * independently of candidate failure. Focus returns to the invoking row after
 * close.
 */
export function SessionResponsibilitySection(props: Readonly<{
    /** The one mounted owner of candidate and mutation state for this Session. */
    controller: SessionResponsibilityController;
    /** The one responsive presentation owner, created beside that controller. */
    pickerHost: SessionResponsibilityPickerHost;
    testID?: string;
}>): React.ReactElement | null {
    const { theme } = useUnistyles();
    const controller = props.controller;
    const editable = controller.availability === 'editable';
    const pickerHost = props.pickerHost;

    if (controller.availability === 'loading') {
        return (
            <ItemGroup title={t('session.responsibilitySectionTitle')}>
                <SelectionListSkeletonRow index={0} testID="session-responsibility-loading" />
            </ItemGroup>
        );
    }

    // An older or non-projecting server says nothing about responsibility. It is
    // never rendered as "No one": that would be a confident, wrong statement.
    // `direct_only` availability is also unsupported: hide rather than claim.
    if (controller.availability === 'unsupported') return null;

    const assigned = controller.responsibleAccountId ?? null;
    const resolvedName = controller.responsibleAccount
        ? formatSessionResponsibilityName(controller.responsibleAccount)
        : null;
    const displayName = assigned === null
        ? t('session.responsibilityNoOne')
        : resolvedName ?? t('session.responsibilityUnnamedPerson');
    const accessibilityLabel = assigned === null && editable
        ? t('session.responsibilityA11yEmpty')
        : t(editable ? 'session.responsibilityA11yEditable' : 'session.responsibilityA11yReadOnly', { name: displayName });

    return (
        <View ref={pickerHost.anchorRef} testID="session-responsibility-anchor">
            <ItemGroup title={t('session.responsibilitySectionTitle')}>
                <Item
                    testID={props.testID ?? 'session-responsibility-row'}
                    pressableRef={pickerHost.triggerRef}
                    title={t('session.responsibilityRowTitle')}
                    subtitle={displayName}
                    subtitleTestID="session-responsibility-value"
                    icon={assigned === null
                        ? <Icon name="person" size={29} color={theme.colors.text.secondary} />
                        : (
                            <Avatar
                                id={assigned}
                                size={29}
                                imageUrl={controller.responsibleAccount?.avatarUrl ?? null}
                            />
                        )}
                    accessibilityLabel={accessibilityLabel}
                    accessibilityRole={editable ? 'button' : 'text'}
                    showChevron={editable}
                    disabled={controller.pending}
                    onPress={editable ? pickerHost.openPicker : undefined}
                />
                {controller.assignmentAutoFollowed ? (
                    <Text
                        testID="session-responsibility-auto-follow-explanation"
                        accessibilityRole="text"
                        style={{
                            color: theme.colors.text.secondary,
                            paddingHorizontal: 16,
                            paddingBottom: 12,
                            ...Typography.default(),
                        }}
                    >
                        {t('session.follow.assignedExplanation')}
                    </Text>
                ) : null}
            </ItemGroup>
            {pickerHost.picker}
        </View>
    );
}

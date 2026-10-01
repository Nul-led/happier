import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { ActionListSection, type ActionListItem } from '@/components/ui/lists/ActionListSection';
import { StatusDot } from '@/components/ui/status/StatusDot';
import { t } from '@/text';
import type { UpdatesContentModel, UpdatesGroup } from '@/updates/useUpdatesContentModel';

import { describeUpdatesGroupRow, type UpdatesGroupRowTone } from './describeUpdatesGroupRow';
import { resolveUpdateItemIconName } from './UpdateRow';

/**
 * The Updates popover's body: one row per machine (and one for this app), each with its mark, name,
 * one status line and at most one action, the same row anatomy as the account popover. The full list
 * of tools lives on the Updates page; nothing here decides anything the updates model does not.
 */
export function UpdatesPopoverRows(props: Readonly<{ model: UpdatesContentModel }>) {
    const { theme } = useUnistyles();
    const { model } = props;
    const { updateGroup, runItem } = model;

    const toneColor = React.useCallback((tone: UpdatesGroupRowTone) => {
        switch (tone) {
            case 'ok':
                return theme.colors.status.connected;
            case 'info':
                return theme.colors.state.info.foreground;
            case 'pending':
                return theme.colors.status.connecting;
            case 'attention':
                return theme.colors.status.actionRequired;
            default:
                return theme.colors.status.default;
        }
    }, [theme]);

    const rows = React.useMemo(() => model.groups.map((group: UpdatesGroup): ActionListItem => {
        const row = describeUpdatesGroupRow(group);
        const color = toneColor(row.tone);
        const action = row.action;
        const where = row.title;
        const onAction = !action
            ? undefined
            : action.kind === 'group'
                ? () => updateGroup(group)
                : () => runItem(action.item);
        return {
            id: `updates-machine-${group.id}`,
            testID: `updates.machine.${group.id}`,
            label: row.title,
            subtitle: row.status,
            subtitleLeading: row.tone === 'attention'
                ? <Icon name="warning" size={11} color={color} />
                : <StatusDot color={color} isPulsing={row.tone === 'pending'} size={6} />,
            // One glyph column: this app by its platform (the rows' own owner), machines by the device glyph.
            icon: <Icon
                name={group.kind === 'app' && group.items[0] ? resolveUpdateItemIconName(group.items[0]) : 'desktop'}
                size={ICON_SIZE.sm}
                color={theme.colors.text.secondary}
            />,
            accessibilityLabel: [row.title, row.status].join(', '),
            right: action && onAction ? (
                <RoundButton
                    testID={`updates.machine.${group.id}.action`}
                    size="small"
                    display="secondary"
                    title={action.label}
                    accessibilityLabel={t('updates.a11y.actionOn', {
                        action: action.label,
                        title: action.kind === 'item' ? action.item.title : row.title,
                        where,
                    })}
                    onPress={onAction}
                />
            ) : undefined,
            rightElementOutsidePressable: action != null,
        };
    }), [model.groups, runItem, theme.colors.text.secondary, toneColor, updateGroup]);

    const extras: ActionListItem[] = model.whatsNewUnread ? [{
        id: 'updates-whats-new',
        testID: 'updates.whatsNew',
        label: t('updates.action.whatsNew'),
        icon: <Icon name="sparkle" size={ICON_SIZE.sm} color={theme.colors.text.secondary} />,
        onPress: model.openWhatsNew,
    }] : [];

    return (
        <>
            <ActionListSection actions={rows} />
            {extras.length > 0 ? <ActionListSection separatorAbove actions={extras} /> : null}
        </>
    );
}

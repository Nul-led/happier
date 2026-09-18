import * as React from 'react';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { Item } from '@/components/ui/lists/Item';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { t } from '@/text';

import { teamRoleLabel } from './teamLabels';
import type { TeamsDirectoryRow } from './teamsDirectoryViewState';

const TEAM_AVATAR_SIZE = 36;

/**
 * One Team in the directory.
 *
 * Identity is the Team's logo when it has one and the deterministic accent the
 * shared avatar owner derives from the immutable Team id otherwise — never from
 * the name, which is presentation and may legitimately be shared by two Teams.
 * The Home is shown only when more than one Home contributes, so a single-Home
 * user is not asked to read a qualifier that cannot disambiguate anything.
 */
export const TeamRow = React.memo(function TeamRow(props: Readonly<{
    row: TeamsDirectoryRow;
    showHome: boolean;
    onPress: () => void;
}>) {
    const { row } = props;
    const roleLabel = row.team.viewerRole ? teamRoleLabel(row.team.viewerRole) : '';
    const subtitle = props.showHome
        ? [roleLabel, row.homeName].filter((part) => part.length > 0).join(' · ')
        : roleLabel;

    return (
        <Item
            testID={`teams-row:${row.address.serverId}:${row.address.teamId}`}
            title={row.team.name}
            subtitle={subtitle.length > 0 ? subtitle : undefined}
            accessibilityLabel={t('teams.directory.rowAccessibilityLabel', {
                name: row.team.name,
                role: roleLabel,
                home: row.homeName,
            })}
            leftElement={(
                <Avatar
                    id={row.address.teamId}
                    square
                    size={TEAM_AVATAR_SIZE}
                    imageUrl={row.team.logo?.url ?? null}
                    thumbhash={row.team.logo?.thumbhash ?? null}
                />
            )}
            rightElement={row.team.archivedAt !== null ? (
                <StatusPill
                    testID={`teams-row-archived:${row.address.teamId}`}
                    variant="neutral"
                    label={t('teams.directory.archivedBadge')}
                    labelVariant="phrase"
                />
            ) : undefined}
            onPress={props.onPress}
        />
    );
});

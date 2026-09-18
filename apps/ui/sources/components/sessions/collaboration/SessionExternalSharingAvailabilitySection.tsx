import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { ExternalSessionSharingAvailability } from '@/components/sessions/external/sharing/useExternalSessionSharingAvailability';
import { t } from '@/text';
import { formatShortRelativeTimeAt } from '@/utils/time/formatShortRelativeTime';
import type { ExactSessionSnapshotState } from './useExactSessionSnapshot';

/**
 * One truthful availability/action projection shared by named Access and
 * anonymous publication. It presents the existing external materialization
 * owner; it neither reconstructs progress nor starts a second workflow.
 */
export function SessionExternalSharingAvailabilitySection(props: Readonly<{
    snapshot: ExactSessionSnapshotState;
    availability: ExternalSessionSharingAvailability | null;
}>): React.ReactElement | null {
    const { theme } = useUnistyles();
    const { snapshot, availability } = props;

    if (snapshot.kind === 'loading') {
        return (
            <ItemGroup title={t('session.sharing.title')}>
                <Item
                    testID="session-external-sharing-loading"
                    title={t('common.loading')}
                    loading
                    mode="info"
                    showChevron={false}
                />
            </ItemGroup>
        );
    }
    if (snapshot.kind === 'authorization_lost') {
        return (
            <ItemGroup title={t('session.sharing.title')}>
                <Item
                    testID="session-external-sharing-authorization-lost"
                    title={t('errors.permissionDenied')}
                    subtitle={t('session.follow.accessLost')}
                    icon={<Icon name="lock" size={29} color={theme.colors.text.secondary} />}
                    mode="info"
                    showChevron={false}
                />
            </ItemGroup>
        );
    }
    if (snapshot.kind === 'unsupported') {
        return (
            <ItemGroup title={t('session.sharing.title')}>
                <Item
                    testID="session-external-sharing-unsupported"
                    title={t('externalSessions.sharingTranscriptUnavailableTitle')}
                    subtitle={t('externalSessions.operationActionErrorUpgradeRequired')}
                    icon={<Icon name="cloud-slash" size={29} color={theme.colors.text.secondary} />}
                    mode="info"
                    showChevron={false}
                />
            </ItemGroup>
        );
    }
    if (snapshot.kind === 'unavailable' || !availability) {
        return (
            <ItemGroup title={t('session.sharing.title')}>
                <Item
                    testID="session-external-sharing-retry"
                    title={t('errors.operationFailed')}
                    subtitle={t('common.retry')}
                    icon={<Icon name="warning-circle" size={29} color={theme.colors.state.warning.foreground} />}
                    onPress={snapshot.retry}
                    showChevron={false}
                />
            </ItemGroup>
        );
    }

    const { sharingPresentation } = availability;
    if (sharingPresentation.state === 'hosted') return null;

    const machineName = sharingPresentation.machineName ?? t('status.unknown');
    if (sharingPresentation.state === 'requires_persisted_import') {
        const subtitle = availability.sourceMachineUnavailableReason
            ?? t('externalSessions.sharingTranscriptOnMachine', { machine: machineName });
        return (
            <ItemGroup title={t('session.sharing.title')}>
                <Item
                    testID="session-external-sharing-materialize"
                    title={t('externalSessions.operationTitleMaterialize')}
                    subtitle={subtitle}
                    icon={<Icon name="cloud-arrow-up" size={29} color={theme.colors.text.secondary} />}
                    loading={availability.materializeInFlight}
                    disabled={availability.materializeInFlight || !availability.sourceMachineOnline}
                    onPress={availability.startMaterialization}
                    showChevron={false}
                    accessibilityLabel={`${t('externalSessions.operationTitleMaterialize')}. ${subtitle}`}
                />
            </ItemGroup>
        );
    }
    if (sharingPresentation.state === 'import_incomplete') {
        const title = availability.canResumePartialImport
            ? t('externalSessions.operationActionResume')
            : t('externalSessions.sharingImportIncomplete');
        const subtitle = availability.canResumePartialImport
            ? t('externalSessions.sharingImportIncomplete')
            : availability.sourceMachineUnavailableReason
                ?? t('externalSessions.sharingActionAwaitingAvailability');
        return (
            <ItemGroup title={t('session.sharing.title')}>
                <Item
                    testID="session-external-sharing-resume"
                    title={title}
                    subtitle={subtitle}
                    icon={<Icon name="cloud-arrow-up" size={29} color={theme.colors.text.secondary} />}
                    loading={availability.resumeInFlight}
                    disabled={!availability.canResumePartialImport || availability.resumeInFlight}
                    onPress={availability.canResumePartialImport ? availability.resumePartialImport : undefined}
                    mode={availability.canResumePartialImport ? undefined : 'info'}
                    showChevron={false}
                />
            </ItemGroup>
        );
    }
    if (sharingPresentation.state === 'shared_snapshot_stale') {
        const staleAt = sharingPresentation.materializedThroughSourceAt;
        return (
            <ItemGroup title={t('session.sharing.title')}>
                {staleAt !== null ? (
                    <Item
                        testID="session-external-sharing-stale"
                        title={t('externalSessions.sharingSharedUpTo', {
                            time: formatShortRelativeTimeAt(staleAt, availability.sharingPresentationNowMs),
                        })}
                        icon={<Icon name="clock" size={29} color={theme.colors.text.secondary} />}
                        mode="info"
                        showChevron={false}
                    />
                ) : null}
                <Item
                    testID="session-external-sharing-update"
                    title={t('externalSessions.sharingUpdateSharedCopy')}
                    subtitle={availability.updateSharedCopySubtitle}
                    icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                    loading={availability.materializeInFlight}
                    disabled={availability.materializeInFlight || !availability.sourceMachineOnline}
                    onPress={availability.startMaterialization}
                    showChevron={false}
                    accessibilityLabel={`${t('externalSessions.sharingUpdateSharedCopy')}. ${availability.updateSharedCopySubtitle}`}
                />
            </ItemGroup>
        );
    }
    return (
        <ItemGroup title={t('session.sharing.title')}>
            <Item
                testID="session-external-sharing-transcript-unavailable"
                title={t('externalSessions.sharingTranscriptUnavailableTitle')}
                subtitle={t('externalSessions.sharingTranscriptUnavailable')}
                icon={<Icon name="cloud-slash" size={29} color={theme.colors.text.secondary} />}
                mode="info"
                showChevron={false}
            />
        </ItemGroup>
    );
}

import * as React from 'react';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useHomeSettingsWithCompanion } from '@/hooks/home/useHomeSettingsWithCompanion';
import { t } from '@/text';

import { useHomeRuntimeExecutor } from '../runtime/homeRuntimeExecutor';
import {
    HomeRestartNowBanner,
    HomeRuntimeSection,
    HostedPersonalHomeRuntimeSection,
    countPendingRestartChanges,
    useHomeServerRelease,
} from '../runtime/HomeRuntimeSections';
import { HomeAdministrationSection } from './HomeAdministrationSection';
import type { HomeAdministrationContext } from './homeAdministrationContext';

/** The Runtime page reads only the settings projection: its pending restart state. */
const NO_COMPANION = async (_scope: ServerAccountScope) => ({ kind: 'succeeded' as const, value: null });

const RuntimePage = React.memo(function RuntimePage(props: Readonly<{ context: HomeAdministrationContext }>) {
    const { context } = props;
    const canView = context.projection.capabilities.viewAdministration;
    const release = useHomeServerRelease(context.scope.serverId, canView);
    const executor = useHomeRuntimeExecutor(context.scope.serverId, release.flavor);
    const reads = useHomeSettingsWithCompanion(context.scope, canView, NO_COMPANION);

    if (!canView) {
        return (
            <ItemGroup description={t('homeGovernance.forbiddenBody')}>
                <Item testID="home-runtime-forbidden" title={t('homeGovernance.forbiddenTitle')} mode="info" showChevron={false} />
            </ItemGroup>
        );
    }
    return (
        <>
            <HomeRestartNowBanner
                context={context}
                executor={executor}
                pendingCount={countPendingRestartChanges(reads.settings)}
                onRestarted={reads.reload}
            />
            <HomeRuntimeSection context={context} release={release} executor={executor} />
            {executor.kind === 'hosting_desktop' && context.projection.capabilities.manageHomeSettings ? (
                <HostedPersonalHomeRuntimeSection />
            ) : null}
        </>
    );
});

/**
 * The server that runs this Home (plan §3.7, lab `hcRuntime-*`): the release the server reports,
 * changes waiting for a restart, and the runtime controls of whoever can act on it — this desktop
 * when it hosts the Home, its Remote host or connected Machine, or nobody here (it says where).
 */
export const HomeAdministrationRuntimeScreen = React.memo(function HomeAdministrationRuntimeScreen(
    props: Readonly<{ serverId: string }>,
) {
    return (
        <HomeAdministrationSection
            serverId={props.serverId}
            title={t('homeGovernance.runtime.title')}
            description={t('homeGovernance.pages.runtime')}
        >
            {(context) => <RuntimePage context={context} />}
        </HomeAdministrationSection>
    );
});

import * as React from 'react';

import { AttentionBanner } from '@/components/ui/lists/AttentionBanner';
import { t } from '@/text';

/**
 * The one tinted notice an agent page shows when something blocks using the agent. It names the
 * problem and carries the next action; healthy agents never render it.
 */
export const AgentAttentionBanner = AttentionBanner;

/**
 * The selected machine is offline: the page shows its last known state and its machine actions are
 * disabled until it reconnects. Retry asks the machine again.
 */
export const AgentMachineOfflineBanner = React.memo(function AgentMachineOfflineBanner(props: Readonly<{
    onRetry: () => void;
}>) {
    return (
        <AgentAttentionBanner
            testID="settings.agents.detail.machineOffline"
            title={t('settingsAgents.offline.bannerTitle')}
            description={t('settingsAgents.offline.bannerDescription')}
            action={{ label: t('common.retry'), onPress: props.onRetry }}
        />
    );
});

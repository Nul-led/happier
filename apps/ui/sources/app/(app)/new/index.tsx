import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import type { ExactTurnAutomationPrefill } from '@/components/automations/sessionLifecycle/exactTurnAutomationPrefill';
import { ComposerBannerCollapseProvider } from '@/components/sessions/composerBanners/ComposerBannerCollapseProvider';
import { NewSessionScreen } from '@/components/sessions/new/NewSessionScreen';

function NewSessionScreenWithComposerBannerScope(props: Readonly<{
    automationExactTurnRetarget?: ExactTurnAutomationPrefill | null;
}>) {
    const { draftId } = useLocalSearchParams<{ draftId?: string }>();
    return (
        <ComposerBannerCollapseProvider key={typeof draftId === 'string' ? draftId : 'new-session'}>
            <NewSessionScreen presentation="screen" automationExactTurnRetarget={props.automationExactTurnRetarget ?? null} />
        </ComposerBannerCollapseProvider>
    );
}

export default React.memo(NewSessionScreenWithComposerBannerScope);

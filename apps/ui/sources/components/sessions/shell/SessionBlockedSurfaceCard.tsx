import * as React from 'react';

import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Icon } from '@/components/ui/icons/Icon';
import { useUnistyles } from 'react-native-unistyles';

import {
    projectSessionBlockedSurfacePresentation,
    type SessionBlockedSurfaceActionIntent,
    type SessionBlockedSurfaceState,
} from './sessionBlockedSurfaceState';

/**
 * The settled body of a Session whose transcript must not render: denied access, or encrypted
 * content this viewer cannot open yet. It states the exact condition and the one next step, and it
 * never shows progress for work nobody is running.
 */
export const SessionBlockedSurfaceCard = React.memo(function SessionBlockedSurfaceCard(props: Readonly<{
    state: Exclude<SessionBlockedSurfaceState, { kind: 'account_recovery' }>;
    collaborationAvailable: boolean;
    onAction: (intent: SessionBlockedSurfaceActionIntent) => void | Promise<unknown>;
}>) {
    const { theme } = useUnistyles();
    const presentation = projectSessionBlockedSurfacePresentation(props.state, {
        collaborationAvailable: props.collaborationAvailable,
    });
    const { onAction } = props;
    const runPrimary = React.useCallback(() => {
        return presentation.action ? onAction(presentation.action.intent) : undefined;
    }, [onAction, presentation.action]);
    const runSecondary = React.useCallback(() => {
        return presentation.secondaryAction ? onAction(presentation.secondaryAction.intent) : undefined;
    }, [onAction, presentation.secondaryAction]);

    return (
        <SurfaceStateCard
            testID={presentation.testID}
            kind={presentation.kind}
            title={presentation.title}
            reason={presentation.reason}
            diagnosticCode={presentation.diagnosticCode}
            accessibilitySemantics="status"
            icon={(
                <Icon
                    name={presentation.iconName}
                    size={32}
                    color={presentation.kind === 'warning'
                        ? theme.colors.state.warning.foreground
                        : theme.colors.text.secondary}
                />
            )}
            {...(presentation.action
                ? { action: { label: presentation.action.label, onPress: runPrimary } }
                : {})}
            {...(presentation.secondaryAction
                ? { secondaryAction: { label: presentation.secondaryAction.label, onPress: runSecondary } }
                : {})}
        />
    );
});

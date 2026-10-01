import * as React from 'react';
import { View } from 'react-native';

import { AppPaneScopeHost } from '@/components/appShell/panes/AppPaneScopeHost';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { useDeviceType } from '@/utils/platform/responsive';

import { AgentSignInTerminal } from './AgentSignInTerminal';
import { AgentSignInTerminalHostProvider, type AgentSignInTerminalTarget } from './signInTerminalHost';

const AGENT_SIGN_IN_TERMINAL_TAB_ID = 'agent-auth-terminal';

/**
 * A page whose agents can be signed in (the machine page, Settings → Agents detail) hosted with a
 * bottom pane, so an agent's own sign-in opens in the app's terminal there (lab T1) — on the desktop
 * app and in the browser alike. Phones have no bottom pane: the same sign-in opens as a sheet (T1p).
 */
export function AgentSignInPaneHost(props: Readonly<{
    scopeId: string;
    main: React.ReactNode;
}>) {
    const pane = useAppPaneScope(props.scopeId);
    const phone = useDeviceType() === 'phone';
    const [target, setTarget] = React.useState<AgentSignInTerminalTarget | null>(null);
    const host = React.useMemo(() => ({
        open: (next: AgentSignInTerminalTarget) => {
            setTarget(next);
            pane.openBottom({ tabId: AGENT_SIGN_IN_TERMINAL_TAB_ID });
        },
    }), [pane]);
    const close = React.useCallback(() => {
        pane.closeBottom();
        setTarget(null);
    }, [pane]);
    const adapter = React.useMemo(() => ({
        destinationIds: [AGENT_SIGN_IN_TERMINAL_TAB_ID],
        render: () => (target ? <AgentSignInTerminal {...target} layout="pane" onClose={close} /> : null),
    }), [close, target]);
    if (phone) return <>{props.main}</>;
    return (
        <View style={{ flex: 1, minHeight: 0 }} {...pane.overlayFocusReturnCaptureProps}>
            <AgentSignInTerminalHostProvider host={host}>
                <AppPaneScopeHost scopeId={props.scopeId} main={props.main} bottomPaneBuiltinAdapter={adapter} />
            </AgentSignInTerminalHostProvider>
        </View>
    );
}

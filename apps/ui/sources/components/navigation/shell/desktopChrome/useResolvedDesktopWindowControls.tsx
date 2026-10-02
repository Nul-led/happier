import * as React from 'react';
import {
    closeDesktopWindow,
    getDesktopWindowChromePolicy,
    listenDesktopWindowState,
    minimizeDesktopWindow,
    toggleDesktopWindowMaximize,
    type DesktopWindowChromeStrategy,
    type DesktopWindowState,
} from '@/utils/platform/desktopWindowBridge';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { DesktopWindowControlsButtons } from './DesktopWindowControlsButtons';
import { DesktopWindowControlsSlot } from './DesktopWindowControlsSlot';

type DesktopWindowControlsVariant = 'expanded' | 'collapsed';

type UseResolvedDesktopWindowControlsParams = Readonly<{
    variant: DesktopWindowControlsVariant;
    desktopWindowControls?: React.ReactNode;
    hasDesktopWindowControlsOverride?: boolean;
}>;

export function useResolvedDesktopWindowControls(
    params: UseResolvedDesktopWindowControlsParams,
): React.ReactNode {
    const hasDesktopWindowControlsOverride = params.hasDesktopWindowControlsOverride === true;
    const [chromeStrategy, setChromeStrategy] = React.useState<DesktopWindowChromeStrategy>('none');
    const [windowState, setWindowState] = React.useState<DesktopWindowState>({ isMaximized: false, isFullscreen: false });

    React.useEffect(() => {
        if (hasDesktopWindowControlsOverride) {
            setChromeStrategy('none');
            setWindowState({ isMaximized: false, isFullscreen: false });
            return;
        }

        let isActive = true;
        let disposeWindowStateListener: (() => Promise<void>) | null = null;

        const loadWindowChrome = async () => {
            const policy = await getDesktopWindowChromePolicy();
            if (!isActive) {
                return;
            }

            setChromeStrategy(policy.strategy);

            if (policy.strategy === 'none') {
                return;
            }
            const dispose = await listenDesktopWindowState((nextState) => {
                if (isActive) {
                    setWindowState((current) => current.isMaximized === nextState.isMaximized
                        && current.isFullscreen === nextState.isFullscreen ? current : nextState);
                }
            });
            if (!isActive) {
                await dispose();
                return;
            }
            disposeWindowStateListener = dispose;
        };

        void loadWindowChrome();

        return () => {
            isActive = false;
            if (disposeWindowStateListener) {
                void disposeWindowStateListener();
            }
        };
    }, [hasDesktopWindowControlsOverride]);

    const handleMinimize = React.useCallback(() => {
        fireAndForget(minimizeDesktopWindow(), { tag: 'DesktopWindowControlsSlot.minimize' });
    }, []);

    const handleToggleMaximize = React.useCallback(() => {
        fireAndForget(toggleDesktopWindowMaximize(), { tag: 'DesktopWindowControlsSlot.toggleMaximize' });
    }, []);

    const handleClose = React.useCallback(() => {
        fireAndForget(closeDesktopWindow(), { tag: 'DesktopWindowControlsSlot.close' });
    }, []);

    if (hasDesktopWindowControlsOverride) {
        return params.desktopWindowControls ?? null;
    }

    if (chromeStrategy === 'none' || windowState.isFullscreen) {
        return null;
    }

    return (
        <DesktopWindowControlsSlot enableDragging>
            {chromeStrategy === 'custom-controls' ? (
                <DesktopWindowControlsButtons
                    layout={params.variant === 'collapsed' ? 'column' : 'row'}
                    isMaximized={windowState.isMaximized}
                    onMinimize={handleMinimize}
                    onToggleMaximize={handleToggleMaximize}
                    onClose={handleClose}
                />
            ) : null}
        </DesktopWindowControlsSlot>
    );
}

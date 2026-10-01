import * as React from 'react';

import {
    createBrowserAutomationControlService,
    type BrowserAutomationControlService,
} from '@/sync/domains/browser/automation';
import type { BrowserShellAutomationState } from '@/components/browser/BrowserShell';
import type { BrowserDiagnosticsEngineBridgeConfig } from '../frame/types';

export type UseBrowserAutomationRuntimeInput = Readonly<{
    enabled?: boolean;
    nowMs?: () => number;
    engineBridge?: BrowserDiagnosticsEngineBridgeConfig | null;
}>;

/**
 * B-RC7 (dark-model wiring): construct the in-app browser-automation control service for the host
 * and project it as the `browserAutomation` product model. The control service is the single shared
 * owner that both the in-iframe automation owner (registered by `WebIframeEngine`) and the runtime
 * action path (`runtimeActionExecutor` via the host's `runtimeAutomationAdapter`) resolve through.
 *
 * Uses the host's existing browser.automation product decision. Collector identity is independent
 * of diagnostics presentation; the service remains stable across ordinary surface re-renders.
 */
export function useBrowserAutomationRuntime(
    input: UseBrowserAutomationRuntimeInput,
): BrowserShellAutomationState | null {
    const enabled = input.enabled === true;
    const nowMs = input.nowMs ?? Date.now;
    const nowMsRef = React.useRef(nowMs);
    nowMsRef.current = nowMs;

    const controlServiceRef = React.useRef<BrowserAutomationControlService | null>(null);
    if (enabled && !controlServiceRef.current) {
        controlServiceRef.current = createBrowserAutomationControlService({
            nowMs: () => nowMsRef.current(),
        });
    }
    if (!enabled) {
        controlServiceRef.current = null;
    }

    const controlService = controlServiceRef.current;
    return React.useMemo<BrowserShellAutomationState | null>(
        () => (controlService ? { controlService, enabled: true, engineBridge: input.engineBridge } : null),
        [controlService, input.engineBridge],
    );
}

import * as React from 'react';

import {
    PLUGIN_UI_CALLER_HOSTED_HTML_HOST_METHODS_V1,
} from '@happier-dev/protocol/plugins/ui';

import { publishPresentationNotice } from '@/components/sessions/presentation/presentationNotices';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';
import { resolveScopedPluginSettingsServerIdentity } from '@/sync/domains/plugins/settings/scopedPluginSettingsRuntime';
import { useServerCredentialAccountScopeBindings } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { createFrontDoorActionExecute } from '@/sync/ops/actions/frontDoorRuntimeActionExecutor';
import { normalizeSessionAccessProjection } from '@/sync/engine/sessions/normalizeSessionAccessProjection';
import { useLocalSettingMutable } from '@/sync/store/hooks';

import { resolveHostedFrameHostOrigin } from '../framed/hostOrigin';
import type { CallerHostedHtmlRuntime } from './HostedHtmlSurfaceAdapter';
import { createSessionCallerHostedHtmlRequestController } from './sessionCallerHostedHtmlRequestController';
import { isHostedInlineDocumentFrameAvailable } from './hostedInlineDocumentFrameCapability';

/** Exact-Home Session adapter for caller-authored HTML. */
export function useSessionCallerHostedHtmlRuntime(
    serverId: string | null | undefined,
    sessionId: string,
    pluginRuntime?: SessionPluginRuntimeState,
): CallerHostedHtmlRuntime | null {
    const requestedServerIds = React.useMemo(() => serverId ? [serverId] : [], [serverId]);
    const bindings = useServerCredentialAccountScopeBindings(requestedServerIds);
    const binding = serverId ? bindings.get(serverId) ?? null : null;
    const [approvals, setApprovals] = useLocalSettingMutable('uiSurfaceExecutableApprovalsV1');
    const execute = React.useMemo(() => createFrontDoorActionExecute(), []);
    const pluginRuntimeRef = React.useRef(pluginRuntime);
    pluginRuntimeRef.current = pluginRuntime;
    const session = useSessionViewShellSession(sessionId, serverId);
    const sessionAccess = session
        ? normalizeSessionAccessProjection(session, { allowLegacy: true })
        : null;
    const sessionCurrent = sessionAccess?.capabilities.readTranscript === true;
    const sessionCurrentRef = React.useRef(sessionCurrent);
    sessionCurrentRef.current = sessionCurrent;
    const hostOrigin = resolveHostedFrameHostOrigin();

    return React.useMemo<CallerHostedHtmlRuntime | null>(() => {
        if (!binding || !hostOrigin || !binding.isCurrent() || !sessionCurrent
            || !isHostedInlineDocumentFrameAvailable()) return null;
        const serverIdentityId = resolveScopedPluginSettingsServerIdentity(binding.serverId);
        if (serverIdentityId === null) return null;
        const isCurrent = () => binding.isCurrent() && sessionCurrentRef.current;
        const pluginTargetCurrent = pluginRuntime?.phase === 'current'
            && pluginRuntime.interactionEnabled
            && pluginRuntime.serverId === binding.serverId
            && pluginRuntime.machineId !== null
            && pluginRuntime.pluginUiProjection?.generation !== null;
        const pluginTarget = pluginTargetCurrent ? {
            machineId: pluginRuntime.machineId!,
            serverId: pluginRuntime.serverId!,
            generation: pluginRuntime.pluginUiProjection!.generation!,
            projection: pluginRuntime.pluginUiProjection!,
            isCurrent: () => isCurrent()
                && pluginRuntimeRef.current?.phase === 'current'
                && pluginRuntimeRef.current.interactionEnabled
                && pluginRuntimeRef.current.serverId === binding.serverId
                && pluginRuntimeRef.current.machineId === pluginRuntime.machineId
                && pluginRuntimeRef.current.pluginUiProjection?.generation
                    === pluginRuntime.pluginUiProjection!.generation,
        } : null;
        return Object.freeze({
            serverIdentityId,
            accountId: binding.accountId,
            hostOrigin,
            admittedHostMethods: PLUGIN_UI_CALLER_HOSTED_HTML_HOST_METHODS_V1.filter(
                (method) => method === 'context' || method === 'watchContext'
                    || method === 'executeAction' || method === 'notify'
                    || (pluginTarget !== null && (method === 'readResource' || method === 'watchResource')),
            ),
            isApproved: (_approval, approvalKey) => approvals[approvalKey] === true,
            approve: (_approval, approvalKey) => setApprovals({ ...approvals, [approvalKey]: true }),
            revoke: (_approval, approvalKey) => {
                const next = { ...approvals };
                delete next[approvalKey];
                setApprovals(next);
            },
            createRequestController: (publishResourceEvent) => createSessionCallerHostedHtmlRequestController({
                sessionId,
                serverId: binding.serverId,
                serverIdentityId,
                accountId: binding.accountId,
                executeHostAction: execute,
                isAccountCurrent: binding.isCurrent,
                isSessionCurrent: () => sessionCurrentRef.current,
                pluginTarget,
                publishResourceEvent,
                notify: ({ requestId, message, severity }) => publishPresentationNotice({
                    key: `caller-hosted-html:${binding.serverId}:${requestId}`,
                    message,
                    severity,
                }),
            }),
            lifetime: Object.freeze({
                isCurrent,
                onRetire: binding.onRetire,
            }),
        });
    }, [approvals, binding, execute, hostOrigin, pluginRuntime, sessionCurrent, sessionId, setApprovals]);
}

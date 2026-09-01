import * as React from 'react';

import { actionOperationPresentationCoordinator } from '@/components/inbox/actionOperations/actionOperationPresentationRuntime';
import {
    readActionOperationDestinationServerId,
    readActionOperationDestinationSessionId,
    readActionOperationSessionSpawnNewInitialInput,
} from '@/components/inbox/actionOperations/actionOperationPresentation';
import { createNewSessionActionOperationOrigin } from '@/components/sessions/new/navigation/newSessionActionOperationOrigin';
import {
    presentCreatedNewSession,
    projectAcceptedNewSessionFirstTurn,
} from '@/components/sessions/new/navigation/presentCreatedNewSession';
import {
    clearCapturedNewSessionDraftAfterLaunch,
    preserveCreatedSessionDraftAfterUnacceptedFirstTurn,
    readCapturedNewSessionFirstTurnText,
} from '@/components/sessions/new/modules/newSessionDraftLifecycle';
import { useActionOperationByRequestId } from '@/sync/domains/actionOperations/useActionOperations';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { CREATED_SESSION_NOT_AVAILABLE_LOCALLY_ERROR } from '@/sync/runtime/sessionMessageDeliveryErrors';
import { captureExceptionIfEnabled } from '@/utils/system/sentry';
import { settleSpawnAttemptCustodyFromActionOperation } from '@/sync/domains/session/spawn/spawnAttemptNonceStore';

type NewSessionReentryRouter = Readonly<{
    replace(path: unknown, options?: unknown): void;
}>;

export function useNewSessionActionOperationReconciliation(params: Readonly<{
    draftId: string;
    requestId: string | null;
    draftScope: ServerAccountScope | null;
    localCreationInFlight: boolean;
    disableDraftPersistence: () => void;
    resetLaunchRequestId: (requestId: null) => void;
    router: NewSessionReentryRouter;
}>): Readonly<{ isCreatingFromOperation: boolean }> {
    const operation = useActionOperationByRequestId(
        params.draftScope ? params.requestId : null,
        params.draftScope?.accountId ?? null,
    );
    const handledTerminalOperationIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        if (!params.requestId || !params.draftScope) return;
        actionOperationPresentationCoordinator.register({
            requestId: params.requestId,
            onStart: 'current',
            origin: createNewSessionActionOperationOrigin(params.draftScope, params.draftId),
        });
    }, [params.draftId, params.draftScope, params.requestId]);

    React.useEffect(() => {
        if (
            params.localCreationInFlight
            || !operation
            || operation.actionId !== 'session.spawn_new'
            || (operation.state !== 'failed' && operation.state !== 'cancelled')
            || handledTerminalOperationIdRef.current === operation.operationId
        ) {
            return;
        }
        handledTerminalOperationIdRef.current = operation.operationId;
        params.resetLaunchRequestId(null);
    }, [operation, params.localCreationInFlight, params.resetLaunchRequestId]);

    React.useEffect(() => {
        if (
            params.localCreationInFlight
            || !params.requestId
            || !params.draftScope
            || !operation
            || operation.actionId !== 'session.spawn_new'
            || operation.state !== 'succeeded'
            || handledTerminalOperationIdRef.current === operation.operationId
        ) {
            return;
        }
        const sessionId = readActionOperationDestinationSessionId(operation);
        if (!sessionId) return;
        const requestId = params.requestId;
        const draftScope = params.draftScope;
        const destinationServerId = readActionOperationDestinationServerId(operation) ?? draftScope.serverId;
        const initialInput = readActionOperationSessionSpawnNewInitialInput(operation);
        const initialInputLocalId = initialInput?.status === 'accepted'
            || initialInput?.status === 'alreadyAccepted'
            ? initialInput.localId
            : null;
        const capturedFirstTurnText = readCapturedNewSessionFirstTurnText({
            scope: draftScope,
            draftId: params.draftId,
            launchUserAttemptId: requestId,
        });
        handledTerminalOperationIdRef.current = operation.operationId;
        let cancelled = false;
        let completed = false;

        void (async () => {
            try {
                const presentation = await presentCreatedNewSession({
                    sessionId,
                    serverId: destinationServerId,
                    requestId,
                    router: params.router,
                    isStillActive: () => !cancelled,
                    operation,
                    prepareDestination: capturedFirstTurnText
                        ? () => {
                            if (initialInputLocalId) {
                                projectAcceptedNewSessionFirstTurn({
                                    sessionId,
                                    localId: initialInputLocalId,
                                    text: capturedFirstTurnText,
                                });
                                return;
                            }
                            preserveCreatedSessionDraftAfterUnacceptedFirstTurn({
                                scope: {
                                    serverId: destinationServerId,
                                    accountId: draftScope.accountId,
                                },
                                sessionId,
                                draftText: capturedFirstTurnText,
                            });
                        }
                        : undefined,
                });
                if (presentation !== 'opened') {
                    if (presentation === 'unavailable') {
                        throw new Error(CREATED_SESSION_NOT_AVAILABLE_LOCALLY_ERROR);
                    }
                    return;
                }
                params.disableDraftPersistence();
                await clearCapturedNewSessionDraftAfterLaunch({
                    scope: draftScope,
                    draftId: params.draftId,
                    launchUserAttemptId: requestId,
                });
                await settleSpawnAttemptCustodyFromActionOperation({
                    scope: {
                        serverId: destinationServerId,
                        accountId: draftScope.accountId,
                    },
                    userAttemptId: requestId,
                    createdSessionId: sessionId,
                });
                completed = true;
            } catch (error) {
                handledTerminalOperationIdRef.current = null;
                captureExceptionIfEnabled(error, {
                    tags: {
                        area: 'new_session',
                        action: 'reconcile_action_operation_success',
                    },
                    extra: {
                        operationId: operation.operationId,
                        sessionId,
                    },
                });
            }
        })();

        return () => {
            cancelled = true;
            if (!completed && handledTerminalOperationIdRef.current === operation.operationId) {
                handledTerminalOperationIdRef.current = null;
            }
        };
    }, [
        operation,
        params.disableDraftPersistence,
        params.draftId,
        params.draftScope,
        params.localCreationInFlight,
        params.router,
    ]);

    return {
        isCreatingFromOperation: operation?.actionId === 'session.spawn_new'
            && (operation.state === 'accepted' || operation.state === 'running'),
    };
}

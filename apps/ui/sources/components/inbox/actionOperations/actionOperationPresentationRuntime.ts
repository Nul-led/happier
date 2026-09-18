import { router } from 'expo-router';

import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { acknowledgeActionOperationPresented } from '@/sync/domains/actionOperations/acknowledgeActionOperationPresented';
import type { QualifiedActionOperation } from '@/sync/domains/actionOperations/qualifiedActionOperation';

import { openActionOperationDetail } from './openActionOperationDetail';
import { createActionOperationPresentationCoordinator } from './actionOperationPresentationCoordinator';
import { readActionOperationDestinationServerId } from './actionOperationPresentation';

export const actionOperationPresentationCoordinator = createActionOperationPresentationCoordinator({
    openDetail: openActionOperationDetail,
    openDestination: (sessionId: string, operation: QualifiedActionOperation) => {
        router.push(buildScopedSessionRouteHref({
            sessionId,
            serverId: readActionOperationDestinationServerId(operation.snapshot, operation.serverId),
        }) as never);
    },
    markPresented: (operation) => {
        acknowledgeActionOperationPresented(operation.snapshot, operation.serverId);
    },
});

export function openActionOperation(operation: QualifiedActionOperation): void {
    actionOperationPresentationCoordinator.open(operation);
}

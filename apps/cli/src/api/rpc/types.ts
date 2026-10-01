/**
 * Common RPC types and interfaces for both session and machine clients
 */

import type { SocketRpcAuthorizationContext } from '@happier-dev/protocol/rpc';
import type { ActionExecutorContext } from '@happier-dev/protocol';
import type { CallerInputConstraintsV1 } from '@happier-dev/protocol/auth/apiTokenGrant';
import type { ExternalActionExecutionAuthorizationV1 } from '@happier-dev/protocol/actions';
import type {
    SocketRpcRequestPayload,
    SocketRpcTransportAcknowledgementV1,
} from '@happier-dev/protocol/socketRpc';

/**
 * Generic RPC handler function type
 * @template TRequest - The request data type
 * @template TResponse - The response data type
 */
/**
 * Host-private Action context for an in-process invocation. It never exists
 * on a transported RPC request, so callers cannot supply causal authority in
 * the public request payload.
 */
export type RpcLocalActionContext = Readonly<Partial<Pick<
    ActionExecutorContext,
    'surface' | 'authority' | 'callerPermissionMode' | 'causalPermissionAuthority' | 'actionRequestId'
    | 'agentStartContext' | 'agentStartWorkDepth' | 'agentStartWorkspaceWrites' | 'sessionAgentSpawnPolicyV1'
>> & {
    /** Exact Workflow invocation store, admitted only by an in-process host. */
    executionRunPermissionRequestStore?: unknown;
    executionRunWorkflowObservationSink?: unknown;
    /** Identity from the admitted in-process Workflow caller; never transported in RPC input. */
    executionRunWorkflowRunId?: string;
    operationProgress?: Readonly<{
        update(progress: Readonly<{
            label?: string;
            phase?: string;
            current?: number;
            total?: number;
        }>): void;
    }>;
    operationOwnerUpdate?: Readonly<{
        update(update: Readonly<{
            progress?: Readonly<{ label?: string; phase?: string; current?: number; total?: number }>;
            domainRef?: import('@happier-dev/protocol/actions').ActionOperationDomainRefV1;
        }>): void;
    }>;
}>;

export type RpcHandlerContext = Readonly<{
    signal: AbortSignal;
    /** Verified server ingress authority; never read from decrypted caller input. */
    callerAuthority?: ActionExecutorContext['authority'];
    /** Validated server ingress constraints, never decrypted caller input. */
    callerInputConstraints?: CallerInputConstraintsV1;
    /** Home transport proof bound before decryption; signed token is verified by downstream admission. */
    callerInputAuthorization?: ExternalActionExecutionAuthorizationV1;
    /** Validated transport correlation; authenticated relays replace caller values before dispatch. */
    transportRequestId?: string;
    /**
     * Server-derived transport context. It is absent for local invocation so
     * an in-process caller cannot synthesize authenticated account authority.
     */
    authorization?: SocketRpcAuthorizationContext;
    localActionContext?: RpcLocalActionContext;
}>;

export type RpcHandler<TRequest = any, TResponse = any> = (
    data: TRequest,
    context?: RpcHandlerContext,
) => TResponse | Promise<TResponse>;

export type RpcHandlerRegistrar = Readonly<{
    registerHandler: <TRequest = any, TResponse = any>(
        method: string,
        handler: RpcHandler<TRequest, TResponse>,
    ) => void;
}>;

export type RpcHandlerInvoker = Readonly<{
    invokeLocal: (method: string, params: unknown, options?: Readonly<{
        signal?: AbortSignal;
        localActionContext?: RpcLocalActionContext;
    }>) => Promise<unknown>;
}>;

export type RpcHandlerManagerLike = RpcHandlerRegistrar & RpcHandlerInvoker;

/**
 * Map of method names to their handlers
 */
export type RpcHandlerMap = Map<string, RpcHandler>;

export type RpcRequest = SocketRpcRequestPayload;

export type RpcAuthorizationResult =
    | Readonly<{ ok: true }>
    | Readonly<{ ok: false; error: string; errorCode?: string }>;

export type RpcHandlerActiveExecution = Readonly<{
    method: string;
    activeForMs: number;
}>;

/**
 * RPC response callback
 */
export type RpcResponseCallback = (response: unknown) => void;

/**
 * Configuration for RPC handler manager
 */
type RpcHandlerCommonConfig = {
    scopePrefix: string;
    /** Actual local runtime Machine, independently of Session metadata. */
    localMachineId?: string | null;
    authorizeRequest?: (request: Readonly<{
        method: string;
        params: unknown;
        authorization?: SocketRpcAuthorizationContext;
        transportResponseEnvelopeVersion?: 1;
    }>) => RpcAuthorizationResult | Promise<RpcAuthorizationResult>;
    projectTransportAcknowledgement?: (request: Readonly<{
        method: string;
        params: unknown;
        result: unknown;
        authorization?: SocketRpcAuthorizationContext;
    }>) => SocketRpcTransportAcknowledgementV1 | null;
    logger?: (message: string, data?: any) => void;
    onRegistrationError?: (error: unknown) => void;
    onRegistrationAcknowledged?: (method: string) => void;
    nowMs?: () => number;
};

export type RpcHandlerConfig = RpcHandlerCommonConfig & (
    | Readonly<{
        encryptionMode: 'plain';
        /**
         * Retained only so older internal callers can migrate without a flag-day.
         * Plain transport never reads either value and keyless callers omit them.
         */
        encryptionKey?: Uint8Array;
        encryptionVariant?: 'legacy' | 'dataKey';
    }>
    | Readonly<{
        encryptionMode?: 'e2ee';
        encryptionKey: Uint8Array;
        encryptionVariant: 'legacy' | 'dataKey';
    }>
);

/**
 * Result of RPC handler execution
 */
export type RpcHandlerResult<T = any> =
    | { success: true; data: T }
    | { success: false; error: string };

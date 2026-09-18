import { FastifyBaseLogger, FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { IncomingMessage, Server, ServerResponse } from "http";
import type { PeerTcpTunnelRelayTransportFactory } from "@/app/machines/peer/mediation/tunnel/peerRelayStreamTransport";
import type { PeerMediationObservabilityEmitter } from "@/app/api/socket/peer/mediation/observability/events";
import type { PeerMediationViewerSocketOwnershipVerifier } from "@/app/api/socket/viewerSocketOwnership";
import type { ExternalActionDaemonDispatcher } from "@/app/api/socket/externalActionDispatcher";
import type { ExternalProviderBrokerDispatch } from "@/app/api/routes/providers/registerExternalProviderApiRoutes";
import type { TeamCredentialResourceTestBrokerDispatch } from "@/app/api/routes/providers/externalProviderBrokerDispatcher";
import type { VerifiedApiTokenPrincipal } from "@/app/auth/auth";
import type { AccountStoredContentCompatibilityEvaluation } from "@/app/clientCompatibility/accountStoredContentCompatibility";
import type { MachineDaemonPresenceSocketServer } from "@/app/machines/machineDaemonPresence";
import type {
    AutomationReplyHandoffDispatchResultV1,
    SessionServerStartDispatchResultV1,
} from "@happier-dev/protocol";
import type { AuthTokenAuthenticationEvidenceV1 } from "@happier-dev/protocol";
import type { VerifiedEphemeralSessionRunnerPrincipal } from "@happier-dev/protocol/ephemeralRunner/principal";
import type { ExternalActionTargetV1 } from "@happier-dev/protocol/actions";

export type EphemeralSessionRunnerHttpOperation =
    | "runtime_features"
    | "session_detail"
    | "session_shared_editor"
    | "session_runtime"
    | "session_follow_destination_runtime"
    | "session_machine_runtime"
    | "session_usage_event"
    | "provider_broker_open";

export type Fastify = FastifyInstance<
    Server<typeof IncomingMessage, typeof ServerResponse>,
    IncomingMessage,
    ServerResponse<IncomingMessage>,
    FastifyBaseLogger,
    ZodTypeProvider
>;

declare module 'fastify' {
    interface FastifyContextConfig {
        /** Raw API-token bearer requests are denied unless an HTTP route explicitly opts in. */
        allowApiToken?: true;
        /** Account Directory tokens are denied unless a Directory route opts in. */
        allowAccountDirectoryToken?: true;
        /** Released pre-provenance Home credentials are denied when a route family opts out. */
        allowLegacyHomeToken?: false;
        /** Runner credentials are denied unless the route names one closed, exact-scope operation. */
        ephemeralSessionRunnerOperation?: EphemeralSessionRunnerHttpOperation;
        /** Keeps connection authentication rejection distinct from an authenticated subject failure. */
        connectionAuthFailureError?: "authentication_failed" | "invalid_token";
        /** Route-family error whose declared response schema represents a denied restricted credential. */
        restrictedAuthFailureError?: "team_forbidden";
        /** Public bearer-only routes can opt out of the global CORS hook. */
        cors?: false;
    }
    interface FastifyRequest {
        userId: string;
        /** Verified credential provenance; missing is never present-user authority. */
        authTokenKind?: "account" | "account_directory" | "terminal" | "api_token" | "ephemeral_session_runner";
        /** Server-stamped authority for Action ingress; never caller-provided input. */
        authAuthority?: "present_user" | "account_automation";
        /** Explicit compatibility provenance; missing never means current. */
        authTokenLegacy?: boolean;
        /** Server-produced method/provider facts carried by the verified credential. */
        authTokenAuthenticationEvidence?: readonly AuthTokenAuthenticationEvidenceV1[];
        /** Request-local verified provenance for an admitted PAT; never a raw bearer. */
        apiTokenPrincipal?: VerifiedApiTokenPrincipal;
        /** Exact server-revalidated Runner scope; Account ownership is not authorization. */
        sessionRuntimePrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
        /** Exact Machine-bound external Action proof admitted this request. */
        externalActionExecutionAuthorized?: true;
        /** Effect id from the verified Machine signature; never read from caller input. */
        externalActionEffectActionId?: string;
        /** Root Action id from the verified execution binding; never read from caller input. */
        externalActionRootActionId?: string;
        /** Exact target from the verified Machine signature; never read from route input. */
        externalActionExecutionTarget?: ExternalActionTargetV1;
        startTime?: number;
        accountStoredContentCompatibility?: AccountStoredContentCompatibilityEvaluation;
    }
    interface FastifyInstance {
        authenticate: any;
        forwardRpcForUser: (params: {
            userId: string;
            method: string;
            params: unknown;
            timeoutMs?: number;
        }) => Promise<
            | { ok: true; result: unknown }
            | { ok: false; error: string; errorCode?: string }
        >;
        forwardAutomationReplyHandoffToMachine: (
            params: unknown,
        ) => Promise<AutomationReplyHandoffDispatchResultV1>;
        forwardSessionServerStartToMachine: (
            params: unknown,
            options?: Readonly<{ signal?: AbortSignal }>,
        ) => Promise<SessionServerStartDispatchResultV1>;
        forwardExternalActionToMachine: ExternalActionDaemonDispatcher;
        forwardExternalProviderBrokerRequest?: ExternalProviderBrokerDispatch;
        forwardTeamCredentialBrokerResourceTest?: TeamCredentialResourceTestBrokerDispatch;
        disconnectAccountSockets: (accountId: string) => void;
        machineDaemonPresence: MachineDaemonPresenceSocketServer;
        createPeerTcpTunnelRelayTransport?: PeerTcpTunnelRelayTransportFactory;
        peerMediationObservability?: PeerMediationObservabilityEmitter;
        verifyPeerMediationViewerSocketOwnership?: PeerMediationViewerSocketOwnershipVerifier;
    }
}

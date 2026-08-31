/**
 * Native Iroh module surface. Lifecycle/status only — tunnel payload bytes
 * never cross this boundary.
 *
 * Two operation families exist on one native owner:
 *
 * 1. Handle-based lifecycle (`createEndpoint`, `startHomeAcceptor`,
 *    `ensureHomeTunnel`, `releaseHomeTunnel`, `stopHomeAcceptor`,
 *    `shutdownEndpoint`, `getEndpointStatus`, `getTunnelStatus`) — the
 *    canonical surface the server/UI composition waves consume.
 * 2. The legacy mobile trio (`startHomeTunnel`/`stopHomeTunnel`/
 *    `getHomeTunnelStatus`) — a thin adapter over the same owner: start
 *    creates/reuses the shared process endpoint and ensures one tunnel lease;
 *    stop releases only that lease and never shuts the endpoint down.
 */
export type NativeIrohModule = Readonly<{
  getAvailability?: () => Record<string, unknown>;
  startHomeTunnel: (request: {
    homeServerIdentityId: string;
    endpointId: string;
    relayPolicy: 'automatic' | 'disabled';
    directAddresses?: readonly string[];
    relayUrls?: readonly string[];
    descriptorRevision?: number;
    endpointKeyPath?: string;
    capProfile?: string;
  }) => Promise<{
    leaseId: string;
    homeServerIdentityId: string;
    homeEndpointId: string;
    runtimeOrigin: string;
    carrier: 'iroh';
    observedPath: 'direct' | 'relay' | 'unknown';
    startedAtMs: number;
    endpointHandle?: string;
  }>;
  stopHomeTunnel: (leaseId: string) => Promise<void>;
  getHomeTunnelStatus?: (homeServerIdentityId: string) => Promise<Record<string, unknown> | null>;
  createEndpoint?: (request: {
    keyPath?: string;
    relayPolicy?: 'automatic' | 'disabled';
    relayUrls?: readonly string[];
    capProfile?: 'homeInteractive' | 'machineBulk' | 'workspaceSync';
  }) => Promise<{
    endpointHandle: string;
    endpointId: string;
    relayMode: 'disabled' | 'custom';
    capProfile: string;
    relayUrls: readonly string[];
  }>;
  startHomeAcceptor?: (request: {
    endpointHandle: string;
    targetHost?: string;
    targetPort: number;
  }) => Promise<{
    endpointHandle: string;
    reused: boolean;
    status: Record<string, unknown>;
  }>;
  stopHomeAcceptor?: (request: { endpointHandle: string }) => Promise<void>;
  ensureHomeTunnel?: (request: {
    endpointHandle: string;
    homeServerIdentityId: string;
    endpointId: string;
    directAddresses?: readonly string[];
    relayUrls?: readonly string[];
    descriptorRevision?: number;
  }) => Promise<{
    tunnelId: string;
    homeServerIdentityId: string;
    homeEndpointId: string;
    runtimeOrigin: string;
    carrier: 'iroh';
    observedPath: 'direct' | 'relay' | 'unknown';
    startedAtMs: number;
    endpointHandle: string;
  }>;
  releaseHomeTunnel?: (tunnelId: string) => Promise<void>;
  shutdownEndpoint?: (request: { endpointHandle: string }) => Promise<void>;
  getEndpointStatus?: (endpointHandle: string) => Promise<Record<string, unknown> | null>;
  getTunnelStatus: (tunnelId: string) => Promise<Record<string, unknown> | null>;
}>;

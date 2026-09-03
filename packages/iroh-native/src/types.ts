export type IrohRelayPolicy = 'automatic' | 'disabled';
export type IrohObservedPath = 'direct' | 'relay' | 'unknown';

/**
 * Descriptor-derived Home tunnel request. `descriptorRevision`, `relayUrls`,
 * `directAddresses`, and `endpointKeyPath` are carried verbatim into the
 * native start request; the persistent key path keeps endpoint identity stable
 * across restarts. Current native behavior: a missing key is created once on
 * first use; a corrupt key fails closed and is never silently rotated.
 * Treating a later missing key as loss that requires explicit re-pair is
 * continuity owned by the server endpoint production lifecycle (which knows a
 * key previously existed), not by this request type.
 */
export type IrohHomeTunnelRequest = Readonly<{
  homeServerIdentityId: string;
  endpointId: string;
  policy: IrohRelayPolicy;
  directAddresses?: readonly string[];
  relayUrls?: readonly string[];
  descriptorRevision?: number;
  endpointKeyPath?: string;
}>;

export type IrohHomeTunnelLease = Readonly<{
  leaseId: string;
  homeServerIdentityId: string;
  homeEndpointId: string;
  runtimeOrigin: string;
  carrier: 'iroh';
  observedPath: IrohObservedPath;
  startedAtMs: number;
  release(): Promise<void>;
}>;

/**
 * Payload-free transport fact projected from the native tunnel owner. Home,
 * profile, descriptor, and UI-generation identity deliberately stay outside
 * this boundary and are attached only by the consuming UI lifecycle owner.
 */
export type IrohNativeTunnelEvent = Readonly<{
  type: 'ready' | 'path_changed' | 'degraded' | 'closed' | 'error';
  tunnelHandle: string;
  status: 'ready' | 'degraded' | 'closed' | 'error';
  observedPath?: IrohObservedPath;
  errorCode?: string;
  atMs: number;
}>;

export type IrohNativeAdapter = Readonly<{
  ensureHomeTunnel(input: IrohHomeTunnelRequest): Promise<IrohHomeTunnelLease>;
  releaseHomeTunnel(leaseId: string): Promise<void>;
  subscribeEvents(leaseId: string, listener: (event: IrohNativeTunnelEvent) => void): () => void;
  /**
   * Terminal boundary: stops observation and releases every native lease this
   * adapter still owns, including a lease it retained because an earlier
   * cleanup failed. Rejects when native custody could not be fully released so
   * the caller keeps this adapter owned and retries here instead of orphaning
   * the native lease.
   */
  dispose(): Promise<void>;
}>;

/**
 * Browser Iroh — the one relay-only endpoint owner for a browser
 * application/profile (Lane 06 amendment A7.2/A7.3).
 *
 * The worker bootstrap under `worker/` is intentionally not re-exported: it is a
 * packaged static asset entry point, not part of the app bundle.
 *
 * The Home tunnel stream surface is consumed in production through the
 * `homeCarrier/browserHomeCarrier` seam (A7.3): a browser carries authenticated
 * Home HTTP and Socket.IO over it. Production callers import that exact seam,
 * never this barrel, so an HTTPS-only session never loads the wasm/worker path.
 * The existing finite-transfer owner also consumes the same tab endpoint for
 * its signed `happier/machine/1` stream; browser workspace sync remains out of
 * scope.
 */
export * from './assets';
export * from './endpointClient';
export * from './homeCarrier/homeTunnelWebSocket';
export * from './homeTunnelHttp';
export * from './hostEligibility';
export * from './machineCarrierStream';
export * from './pageLifecycleRelease';
export * from './protocol';
export * from './sharedEndpointOwner';
export * from './wasmBinder';
export * from './workerConnection';

/**
 * Plan-named Iroh UI integration entry (lane-06 §11.2). The direct-publishing
 * adapter was replaced by the verified lifecycle runtime below: it acquires and
 * releases the native lease through the shared loopback supervisor and publishes
 * the runtime origin only after the full probe chain succeeds.
 */
export * from './runtime';

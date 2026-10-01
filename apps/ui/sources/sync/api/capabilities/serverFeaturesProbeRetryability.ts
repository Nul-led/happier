import type { ServerFeaturesSnapshot } from './serverFeaturesClient';

/** The public feature probe's one transient-error classification. */
export function isServerFeaturesProbeRetryable(snapshot: ServerFeaturesSnapshot): boolean {
    if (snapshot.status !== 'error') return false;
    if (snapshot.reason === 'network' || snapshot.reason === 'timeout') return true;
    return snapshot.reason === 'response_status' && snapshot.httpStatus !== undefined
        && (snapshot.httpStatus === 408 || snapshot.httpStatus === 429 || snapshot.httpStatus >= 500);
}

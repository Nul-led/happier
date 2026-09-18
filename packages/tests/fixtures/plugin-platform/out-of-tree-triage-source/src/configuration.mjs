/**
 * The source's own configured-instance token codec.
 *
 * It is a bounded, source-decoded string: it carries the provider space this
 * instance reads and nothing else — no credential, no origin, no account ref.
 *
 * It lives in its own module because two consumers decode it: the three source
 * operations, and the mounted detail document producer. Spelling the token
 * format a second time in either place would make the configured space two
 * facts that can disagree.
 */
import { isLedgerSpace } from './ledger.mjs';

export function encodeConfiguration(space) {
    return { v: 1, token: `space=${space}` };
}

export function decodeConfiguration(configuration) {
    const token = configuration?.token;
    if (typeof token !== 'string' || !token.startsWith('space=')) return null;
    const space = token.slice('space='.length);
    // A space this provider does not serve is unreadable, not empty. Returning
    // an empty successful walk would tell the aggregate the source is healthy
    // and has nothing, which is the one answer it cannot truthfully give.
    return isLedgerSpace(space) ? space : null;
}

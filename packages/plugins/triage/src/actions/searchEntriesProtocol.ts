/**
 * The Universal Search query Action's plugin-local contribution id.
 *
 * It declares no schemas of its own. The canonical `{ query, limit }` input and
 * `{ items, truncated }` result are the SDK's published search contract, which
 * the manifest imports directly — a Triage-local restatement would be a second
 * description of one wire.
 */
export const TRIAGE_SEARCH_ENTRIES_ACTION_LOCAL_ID_V1 = 'entries/search-v1';

/**
 * The provider descriptor's own local id.
 *
 * Contribution local ids are unique across every family, so it cannot be
 * `entries`: the Composer control already holds that id.
 */
export const TRIAGE_SEARCH_PROVIDER_LOCAL_ID_V1 = 'entry-search';

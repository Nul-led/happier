import {
    computeCanonicalDomainSeparatedDigest,
    MAX_PLUGIN_SEARCH_SUBTITLE_CODE_POINTS_V1,
    MAX_PLUGIN_SEARCH_TITLE_CODE_POINTS_V1,
    type PluginInvocationContext,
} from '@happier-dev/plugin-sdk';
import type { ActionHandler } from '@happier-dev/plugin-sdk/actions';
import type {
    PluginSearchItemV1,
    PluginSearchQueryV1,
    PluginSearchResultV1,
} from '@happier-dev/plugin-sdk';

import { bindCorpusCollections } from '../corpus/collections/bindCorpusCollections.js';
import { entryReferenceComponents } from '../corpus/identity/components.js';
import { buildTriageEntryDetailLaunchInput } from '../composer/entryDetailLaunchInput.js';
import { TRIAGE_APP_PAGE_LOCAL_ID_V1 } from '../composer/openEntryDetails.js';
import { requireTriageAccountStorage } from '../requiredAccountStorage.js';
import { MAX_TRIAGE_LIST_WINDOW_ROWS_V1 } from '../projection/listWindow.js';
import { projectTriageEntryDisplay } from '../ui/window/entryDisplay.js';
import { boundTriageDisplayText } from '../ui/window/boundDisplayText.js';
import { TRIAGE_SOURCES_CONTRIBUTION_POINT_REF_V1 } from '../manifest.js';
import {
    assembleTriageListPass,
    type TriageListEntriesDepsV1,
} from './listEntries.js';

/**
 * The Universal Search query Action.
 *
 * It is deliberately a SECOND Action over the SAME owners, not a second search.
 * The heavyweight list contract carries lenses, facets, lane health, coverage,
 * per-connection observations and paging frontiers; none of that is the bounded
 * `{ query, limit } → { items, truncated }` DTO the universal surface speaks,
 * and widening the list result to carry both would make one wire answer two
 * questions. So this Action assembles the SAME pass through
 * `assembleTriageListPass` — the same configured sources, the same scan, the
 * same canonical matcher in `entrySearch.ts`, the same fold and the same
 * `smart` order — and projects it with the SAME display owner the list and the
 * Composer picker read.
 *
 * Activation is the incumbent open owner: every row carries an `openSurface`
 * command for the one Triage app-page destination, holding the exact strict
 * launch input `openTriageEntryDetails` would have built. There is no second
 * navigation path, and the host never learns a Triage route.
 */

export type TriageSearchEntriesDepsV1 = TriageListEntriesDepsV1;

type TriageAssembledRow = Awaited<
    ReturnType<typeof assembleTriageListPass>
>['window']['rows'][number];

const TRIAGE_SEARCH_RESULT_ID_DOMAIN_V1 = 'happier:triage:search-result-id:v1';

function deriveTriageSearchResultId(row: TriageAssembledRow): string {
    return computeCanonicalDomainSeparatedDigest(
        TRIAGE_SEARCH_RESULT_ID_DOMAIN_V1,
        entryReferenceComponents(row.entryRef),
    );
}

/**
 * A row with no selectable connection is omitted rather than shown.
 *
 * Its entry is real, but nothing can be opened under it: the detail page
 * addresses one exact connection, and choosing one for the reader would open a
 * different provider's answer than the row describes. An unopenable row in a
 * search result is worse than an absent one.
 */
function toSearchItem(
    row: TriageAssembledRow,
): readonly PluginSearchItemV1[] {
    if (row.selected.kind !== 'selected') return [];
    const display = projectTriageEntryDisplay(row);
    return [{
        id: deriveTriageSearchResultId(row),
        title: boundTriageDisplayText(display.title, MAX_PLUGIN_SEARCH_TITLE_CODE_POINTS_V1),
        subtitle: boundTriageDisplayText(display.scopeLabel, MAX_PLUGIN_SEARCH_SUBTITLE_CODE_POINTS_V1),
        icon: 'action',
        command: {
            kind: 'openSurface',
            destination: TRIAGE_APP_PAGE_LOCAL_ID_V1,
            input: buildTriageEntryDetailLaunchInput({
                entryRef: row.entryRef,
                sourceInstance: {
                    source: row.entryRef.source,
                    sourceInstanceId: row.selected.sourceInstanceId,
                },
            }),
            // The destination's host-owned page root. The opened page's own
            // location writer replaces it with the canonical entry encoding.
            subPath: '',
        },
    }];
}

export async function searchTriageEntries(
    input: PluginSearchQueryV1,
    deps: TriageSearchEntriesDepsV1,
): Promise<PluginSearchResultV1> {
    const limit = Math.max(1, Math.min(input.limit, MAX_TRIAGE_LIST_WINDOW_ROWS_V1));
    const pass = await assembleTriageListPass({
        v: 1,
        sources: { kind: 'allConfigured' },
        limit,
        // The reader typed a query, so relevance is what they asked for; `smart`
        // is the canonical ranked order and its default policy is the one the
        // ranker owns.
        order: 'smart',
        query: input.query,
    }, deps);
    const openableItems = pass.window.rows.flatMap(toSearchItem);
    const items = openableItems.slice(0, limit);
    return {
        items,
        // Honest bounding: a window whose lanes have not all exhausted has more
        // to give, and an openable row cut by the bound is one the reader has
        // not seen.
        truncated: pass.window.coverage !== 'complete'
            || openableItems.length > items.length,
    };
}

/**
 * The registered handler. It binds the owner above to the invocation context
 * exactly as the list Action does, and adds no dispatch, cache or registry.
 */
export function createTriageSearchEntriesActionHandler(): ActionHandler<
    PluginSearchQueryV1,
    PluginSearchResultV1
> {
    return async (input, context: PluginInvocationContext) => await searchTriageEntries(input, {
        sourceInstances: bindCorpusCollections(requireTriageAccountStorage(context)).sourceInstances,
        readAdmittedSources: async (options) => {
            const observation = context.services.targetedContributions.observeForSelf(
                TRIAGE_SOURCES_CONTRIBUTION_POINT_REF_V1,
                { onInvalidated: () => {} },
            );
            try {
                const snapshot = await observation.readCurrent(options);
                return snapshot.contributions;
            } finally {
                observation.dispose();
            }
        },
        executeScan: async (operation, scanInput, options) => await context.services.actions
            .executeAdmittedTargetedOperation(operation, scanInput, options ?? {}),
        nowMs: () => Date.now(),
        signal: context.signal,
    });
}

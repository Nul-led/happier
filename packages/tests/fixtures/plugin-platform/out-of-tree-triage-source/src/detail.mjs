/**
 * The source's mounted detail body.
 *
 * `map.mjs` projects the owner as the labelled `detailOnly` arm: the list says
 * the fact exists and refuses to invent its value. Something has to actually
 * resolve it, and that something must be reachable by a reader — a module-level
 * helper resolves nothing a mounted surface can show.
 *
 * The public path for that is a declarative renderer bound to a live document:
 * `ui.renderers[ledger-detail]` declares `documentSource`, and this producer
 * answers each read with one V1 declarative document. Because the Resource is
 * declared `scope: 'surface'`, the host stamps the mount's own context onto the
 * read — `{ kind: 'surface', mountInstanceKey, launchInput }` — and for a Triage
 * detail mount that `launchInput` is the published `TriageDetailSurfaceInputV1`
 * the aggregate builds in `ui/detail/input.ts`. That is the whole selection
 * authority: the exact configured instance and the exact selected entry ref.
 *
 * Two rules are load-bearing here:
 *
 * 1. The launch input is gated on one `safeParse` of the published schema. The
 *    envelope is `additive-open/drop` precisely so a source pins its own copy
 *    and refuses whole rather than believing half of a shape it cannot read.
 * 2. The configured space and the selected entry's collision scope must agree.
 *    Answering from the configured space alone would hand the reader some other
 *    entry's owner under the selected entry's name.
 */
import {
    PLUGIN_DECLARATIVE_DOCUMENT_CONTENT_TYPE_V1,
    definePluginDeclarativeDocumentV1,
} from '@happier-dev/plugin-sdk/ui';
import { TriageDetailSurfaceInputV1Schema } from '@happier-dev/triage-protocol/v1';

import { decodeConfiguration } from './configuration.mjs';
import { readLedgerDetailOnlyFacts } from './ledger.mjs';

export const LEDGER_DETAIL_DOCUMENT_RESOURCE_ID = 'ledger-detail-document';
export const LEDGER_DETAIL_DOCUMENT_CONTENT_TYPE = PLUGIN_DECLARATIVE_DOCUMENT_CONTENT_TYPE_V1;

/** One entry's document is a handful of short labelled values. */
export const LEDGER_DETAIL_DOCUMENT_MAX_BYTES = 8_192;

const NO_OWNER_RECORDED = 'No owner is recorded for this entry.';

/**
 * What the renderer paints before its first live document arrives, and if the
 * document ever becomes unavailable.
 *
 * It deliberately states nothing about any entry. A static root that named an
 * owner would be a value no read produced.
 */
export const LEDGER_DETAIL_STATIC_ROOT = Object.freeze({
    kind: 'group',
    title: 'Acme Ledger entry',
    children: [Object.freeze({
        kind: 'status',
        label: 'Owner',
        value: 'Waiting for this entry to load.',
    })],
});

function document(children) {
    return JSON.stringify(definePluginDeclarativeDocumentV1({
        version: 1,
        root: { kind: 'group', title: 'Acme Ledger entry', children },
    }));
}

function unresolved(reason) {
    return document([{ kind: 'status', label: 'Owner', value: reason }]);
}

/**
 * Builds one detail document for the mount context the host stamped.
 *
 * Deliberately module-private: the registered producer below is the only way in,
 * for the host and for this fixture's own tests alike. An exported builder would
 * be a second entry point that can be proven working while nothing a reader can
 * reach ever calls it.
 */
function buildLedgerDetailDocument(context) {
    if (context?.kind !== 'surface') {
        return unresolved('This detail is not mounted for an entry.');
    }
    const parsed = TriageDetailSurfaceInputV1Schema.safeParse(context.launchInput);
    if (!parsed.success) {
        return unresolved('This detail was mounted with an input this source cannot read.');
    }

    const input = parsed.data;
    const space = decodeConfiguration(input.instance.configuration);
    const entryRef = input.observation.entryRef;
    if (space === null || space !== entryRef.collisionScope) {
        return unresolved('This entry is not in the space this connection reads.');
    }

    const facts = readLedgerDetailOnlyFacts(space, entryRef.entryId);
    return document([
        { kind: 'status', label: 'Entry', value: `${entryRef.collisionScope} ${entryRef.entryId}` },
        {
            kind: 'status',
            label: 'Owner',
            value: facts === null ? NO_OWNER_RECORDED : facts.owner,
        },
    ]);
}

export const ledgerDetailDocumentResource = Object.freeze({
    read(options) {
        return buildLedgerDetailDocument(options.context);
    },
    observe() {
        // The fixture provider is deterministic and immutable within a plugin
        // generation, so the bytes this producer would return never change.
        // Registering a watch would invent an invalidation source that has
        // nothing to observe.
        return Object.freeze({ dispose() {} });
    },
});

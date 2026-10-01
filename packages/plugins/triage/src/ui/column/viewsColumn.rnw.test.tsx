// @vitest-environment jsdom
import { act } from 'react';
import { createPluginUiTestkit, createSurfaceContextFixture } from '@happier-dev/plugin-sdk/testing';
import type { PluginUiTestkit, PluginUiTestkitOpenSurfaceInput } from '@happier-dev/plugin-sdk/testing';
import { createPluginUiRnwSemanticSurfaceAdapter } from '@happier-dev/plugin-ui/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { readTriageSavedViewsForSurface } from '../../actions/savedViews.js';
import {
    TRIAGE_READ_SAVED_VIEWS_ACTION_LOCAL_ID_V1,
    TriageReadSavedViewsInputV1Schema,
} from '../../actions/savedViewsProtocol.js';
import { TRIAGE_SAVED_VIEWS_ACCOUNT_KV_KEY_V1 } from '../../settings/savedViews.js';
import { createTestkitAccountKv } from '../../settings/testkit/accountKv.test-support.js';
import { parseTriageRouteSubPathV1 } from '../navigation/location.js';
import { renderSurface as renderViewsColumn } from './viewsColumn.js';

/**
 * The PRs & Issues shell column.
 *
 * It is navigation over the page's own location: the selected row follows the
 * page `subPath` the host hands it, and a row opens the page at that view's
 * full lens. A column that kept its own selection would disagree with the page
 * after a Back, a deep link or a copied URL — the failure pinned here.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REVIEW_ID = '0000000c-0000-4000-8000-00000000000c';
const DONE_ID = '0000000d-0000-4000-8000-00000000000d';

function savedViews() {
    const view = (viewId: string, label: string, states: readonly string[]) => ({
        viewId,
        label,
        query: '',
        filters: { sources: [], types: [], scopes: [], states, attention: [] },
        order: 'newest',
        smartPolicy: { v: 1, precedence: ['activity', 'attention'] },
    });
    return {
        v: 1,
        views: [view(REVIEW_ID, 'Needs review', ['open']), view(DONE_ID, 'Recently done', ['done'])],
        selectedViewId: null,
    };
}

const mounted: PluginUiTestkit[] = [];

async function mountColumn(subPath: string): Promise<Readonly<{
    column: PluginUiTestkit;
    opened: PluginUiTestkitOpenSurfaceInput[];
}>> {
    const accountKv = createTestkitAccountKv();
    accountKv.seed(TRIAGE_SAVED_VIEWS_ACCOUNT_KV_KEY_V1, savedViews());
    const opened: PluginUiTestkitOpenSurfaceInput[] = [];
    let fixture!: PluginUiTestkit;
    await act(async () => {
        fixture = await createPluginUiTestkit({
            identity: { instanceId: 'fixture-views-column', mountNonce: `column-${mounted.length}` },
            authorPlugin: { id: 'happier.triage', version: '0.0.0' },
            surface: renderViewsColumn,
            surfaceContext: createSurfaceContextFixture(),
            adapter: createPluginUiRnwSemanticSurfaceAdapter({}),
            subPath,
            handlers: {
                executeAction: async ({ action, input }) => {
                    if (String(action) !== TRIAGE_READ_SAVED_VIEWS_ACTION_LOCAL_ID_V1) throw new Error(`unexpected ${String(action)}`);
                    return await readTriageSavedViewsForSurface(TriageReadSavedViewsInputV1Schema.parse(input), {
                        catalog: accountKv.catalog(TRIAGE_SAVED_VIEWS_ACCOUNT_KV_KEY_V1),
                        mintViewId: () => 'unused',
                    });
                },
                openSurface: (request) => { opened.push(request); },
            },
        });
    });
    mounted.push(fixture);
    await act(async () => { await Promise.resolve(); });
    return { column: fixture, opened };
}

afterEach(async () => {
    for (const fixture of mounted.splice(0)) await fixture.dispose();
});

/** The rows marked as the page the reader is on (`aria-current="page"`, the plane's selected chip). */
function currentRowIds(): readonly string[] {
    return [...document.querySelectorAll('[data-testid^="triage-views-column."][aria-current="page"]')]
        .map((element) => element.getAttribute('data-testid') ?? '');
}

describe('the PRs & Issues views column', () => {
    it('opens the page at a view\'s full lens through the page location', async () => {
        const { column, opened } = await mountColumn('');
        await column.findByRole('button', { name: 'Needs review' });

        await act(async () => {
            await column.press(await column.getByRole('button', { name: 'Recently done' }));
        });

        expect(opened).toHaveLength(1);
        expect(opened[0]!.view).toEqual({ pluginId: 'happier.triage', localId: 'triage' });
        const lens = parseTriageRouteSubPathV1(opened[0]!.subPath);
        expect(lens.selectedViewId).toBe(DONE_ID);
        expect(lens.filters.states).toEqual(['done']);
        expect(lens.selection).toBeNull();
    });

    it('selects the row the page location names, and follows it when the page moves', async () => {
        const { column } = await mountColumn(`sv,${REVIEW_ID}/fst,open`);
        await column.findByRole('button', { name: 'Needs review' });
        expect(currentRowIds()).toEqual([`triage-views-column.view.${REVIEW_ID}`]);

        await act(async () => { await column.updatePageLocation(''); });
        expect(currentRowIds()).toEqual(['triage-views-column.all']);
    });
});

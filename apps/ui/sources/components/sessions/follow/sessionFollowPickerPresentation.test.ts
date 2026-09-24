import { describe, expect, it } from 'vitest';

import { buildSessionFollowPickerContextTitle, resolveSessionFollowPickerPresentation } from './sessionFollowPickerPresentation';

describe('resolveSessionFollowPickerPresentation', () => {
    it('keeps currentness truthful while retaining available rows', () => {
        expect(resolveSessionFollowPickerPresentation({ kind: 'initial_loading' }, 0)).toEqual({
            statusKey: 'sessionsList.queryInitialLoadingTitle',
            canSelect: false,
            canRetryQuery: false,
        });
        expect(resolveSessionFollowPickerPresentation({ kind: 'refreshing', retainedRows: true }, 2)).toEqual({
            statusKey: 'sessionsList.queryUpdatingTitle',
            canSelect: true,
            canRetryQuery: false,
        });
        expect(resolveSessionFollowPickerPresentation({ kind: 'ready', complete: false }, 2)).toEqual({
            statusKey: 'sessionsList.queryMoreAvailableTitle',
            canSelect: true,
            canRetryQuery: false,
        });
        expect(resolveSessionFollowPickerPresentation({ kind: 'ready', complete: true }, 2)).toEqual({
            statusKey: null,
            canSelect: true,
            canRetryQuery: false,
        });
    });

    it('does not present a partial or failed zero-row corpus as an authoritative empty list', () => {
        expect(resolveSessionFollowPickerPresentation({
            kind: 'partial',
            unavailableHomes: [{ serverId: 'home-a', reason: 'offline' }],
        }, 0)).toEqual({
            statusKey: 'sessionsList.querySomeHomesUnavailableTitle',
            canSelect: false,
            // Neither state advances the query on its own, so both owe an explicit retry.
            canRetryQuery: true,
        });
        expect(resolveSessionFollowPickerPresentation({ kind: 'error', retainedRows: false }, 0)).toEqual({
            statusKey: 'sessionsList.queryRefreshFailedTitle',
            canSelect: false,
            canRetryQuery: true,
        });
    });

    it('keeps the fixed Session and exact Home visible without falling back to opaque identifiers', () => {
        expect(buildSessionFollowPickerContextTitle({
            actionTitle: 'Follow in another Session…',
            sessionTitle: 'Release prep',
            homeName: 'Studio Home',
        })).toBe('Follow in another Session… · Release prep · Studio Home');
        expect(buildSessionFollowPickerContextTitle({
            actionTitle: 'Follow in another Session…',
            sessionTitle: null,
            homeName: null,
        })).toBe('Follow in another Session…');
    });
});

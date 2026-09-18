import { describe, expect, it } from 'vitest';

import { resolveSessionListOrganizationServerIds } from './sessionListOrganizationServerIds';

describe('resolveSessionListOrganizationServerIds', () => {
    it('uses the exact query Home selection when the query owner is mounted', () => {
        expect(resolveSessionListOrganizationServerIds({
            queryHomeServerIds: ['home-b'],
            allowedServerIds: ['home-a', 'home-b'],
            activeServerId: 'home-a',
        })).toEqual(['home-b']);
    });

    it('keeps an intentionally empty query selection empty instead of falling back to the mounted Homes', () => {
        expect(resolveSessionListOrganizationServerIds({
            queryHomeServerIds: [],
            allowedServerIds: ['home-a', 'home-b'],
            activeServerId: 'home-a',
        })).toEqual([]);
    });

    it('covers every Home whose rows the ordinary list can present when no query owner is mounted', () => {
        // The legacy/ordinary corpus presents rows for every mounted Home, so the
        // organization read must span the same Homes or those rows lose their pins,
        // tags, folders and standing.
        expect(resolveSessionListOrganizationServerIds({
            allowedServerIds: ['home-a', ' home-b '],
            activeServerId: 'home-a',
        })).toEqual(['home-a', 'home-b']);
    });

    it('falls back to the focused Home only when no Home is mounted', () => {
        expect(resolveSessionListOrganizationServerIds({
            allowedServerIds: [],
            activeServerId: ' home-a ',
        })).toEqual(['home-a']);
        expect(resolveSessionListOrganizationServerIds({})).toEqual([]);
    });

    it('returns a referentially stable empty result so subscribers do not churn', () => {
        expect(resolveSessionListOrganizationServerIds({ allowedServerIds: [], activeServerId: null }))
            .toBe(resolveSessionListOrganizationServerIds({}));
    });

    it('deduplicates equivalent Home ids', () => {
        expect(resolveSessionListOrganizationServerIds({
            queryHomeServerIds: ['home-a', 'home-a', '', 'home-b'],
        })).toEqual(['home-a', 'home-b']);
    });
});

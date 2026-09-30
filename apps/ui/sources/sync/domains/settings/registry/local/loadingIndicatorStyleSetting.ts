import { z } from 'zod';

/**
 * Which loading indicator `ActivitySpinner` draws.
 *
 * Every id except `classicRing` is a dot style: the H of Happier on a 3 × 3 grid with light moving
 * through it. `classicRing` keeps the original rotating ring for people who prefer it.
 */
export const LOADING_INDICATOR_STYLE_IDS = [
    'wave',
    'handwritten',
    'buildAndRelease',
    'relay',
    'twinStems',
    'slowBreath',
    'starfield',
    'sweep',
    'radar',
    'ripple',
    'aurora',
    'classicRing',
] as const;

export type LoadingIndicatorStyleId = (typeof LOADING_INDICATOR_STYLE_IDS)[number];

export const DEFAULT_LOADING_INDICATOR_STYLE_ID = 'wave' satisfies LoadingIndicatorStyleId;

const LOADING_INDICATOR_STYLE_ID_SET: ReadonlySet<string> = new Set(LOADING_INDICATOR_STYLE_IDS);

export function isLoadingIndicatorStyleId(value: unknown): value is LoadingIndicatorStyleId {
    return typeof value === 'string' && LOADING_INDICATOR_STYLE_ID_SET.has(value);
}

export function normalizeLoadingIndicatorStyleId(value: unknown): LoadingIndicatorStyleId {
    return isLoadingIndicatorStyleId(value) ? value : DEFAULT_LOADING_INDICATOR_STYLE_ID;
}

/**
 * `.catch` matters here: `localSettingsParse` resets EVERY local setting when one field fails to
 * parse, so a style id written by a newer build (or one removed later) must degrade to the default
 * rather than wipe the user's other preferences.
 */
export const LoadingIndicatorStyleIdSchema = z.enum(LOADING_INDICATOR_STYLE_IDS).catch(DEFAULT_LOADING_INDICATOR_STYLE_ID);

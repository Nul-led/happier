import type { CustomModalChromeCardConfig } from '@/modal/types';

import type { ModalCardDimensionOptions } from './useModalCardDimensions';

/**
 * The command-surface card: Search / ⌘K and Browse external sessions. One owner for its geometry, so
 * every command surface opens in the same frame (width, height cap, radius and shadow from
 * `ModalCardFrame`), placed near the top of the window on web, with the search band as the top of
 * the card (no title band; the title stays the dialog's accessible name).
 */
export const COMMAND_SURFACE_CARD_DIMENSIONS: ModalCardDimensionOptions = Object.freeze({
    width: 800,
    maxHeightRatio: 0.7,
    size: 'lg',
});

/** Web placement of a command surface in the modal shell (`BaseModal` `webPlacement`). */
export const COMMAND_SURFACE_WEB_PLACEMENT = 'top' as const;

export function buildCommandSurfaceCardChrome(params: Readonly<{
    title: string;
    testID?: string;
    closeButtonTestID?: string;
}>): CustomModalChromeCardConfig {
    return {
        kind: 'card',
        header: 'none',
        title: params.title,
        ...(params.testID ? { testID: params.testID } : {}),
        ...(params.closeButtonTestID ? { closeButtonTestID: params.closeButtonTestID } : {}),
        // The list inside is the one scroll owner; the card keeps its height as results change.
        scrollHost: 'body',
        bodyScroll: 'none',
        dimensions: COMMAND_SURFACE_CARD_DIMENSIONS,
    };
}

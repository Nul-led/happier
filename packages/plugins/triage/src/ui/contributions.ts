import type { PluginUiIconTokenV1 } from '@happier-dev/plugin-sdk/ui';

/**
 * The declared icon of the `entries` Composer control.
 *
 * `inbox` is not an admitted `PluginUiIconTokenV1` — the token vocabulary is a
 * closed enum with no inbox — and `action` is the closest admitted token for a
 * queue of things waiting on you. It lives here rather than beside the compact
 * renderer because the manifest declares it: importing it from a `.tsx` module
 * would drag React into the daemon manifest graph and close an import cycle
 * through `TRIAGE_DISPLAY_NAME`.
 */
export const TRIAGE_ENTRIES_CONTROL_ICON_V1: PluginUiIconTokenV1 = 'action';

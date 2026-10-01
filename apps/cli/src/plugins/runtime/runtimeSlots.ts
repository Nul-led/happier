import type { PluginSourceCustody } from './sourceAuthority';

declare const pluginRuntimeOccurrenceIdBrand: unique symbol;

export type PluginRuntimeOccurrenceId = string & Readonly<{
    [pluginRuntimeOccurrenceIdBrand]: true;
}>;

let nextPluginRuntimeOccurrence = 0;

/** The occurrence a slot serves new admissions from. Process-local; never persisted. */
export type PluginRuntimeSlotOccurrence = Readonly<{
    occurrenceId: PluginRuntimeOccurrenceId;
    sourceCustody: PluginSourceCustody | null;
}>;

/**
 * One long-lived slot per admitted plugin id, owned by the reload controller.
 * The slot object is stable while the plugin stays admitted; publication swaps
 * only `current` of the plugins whose occurrence changed. `current` is null
 * while the serving occurrence is fenced and no successor is published yet.
 */
export type PluginRuntimeSlot = Readonly<{
    pluginId: string;
    current: PluginRuntimeSlotOccurrence | null;
}>;

/**
 * Allocates an opaque identity for one existing lifecycle component. The
 * reload controller's slot map is the currentness owner; this helper stores no
 * registry, current pointer, source fact, or durable state.
 */
export function createPluginRuntimeOccurrenceId(pluginId: string): PluginRuntimeOccurrenceId {
    nextPluginRuntimeOccurrence += 1;
    return `${pluginId}:${nextPluginRuntimeOccurrence}` as PluginRuntimeOccurrenceId;
}

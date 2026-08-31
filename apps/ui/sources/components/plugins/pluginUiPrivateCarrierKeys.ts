/**
 * Mounted-host half of Plugin UI's cooperative cross-copy marker. The bundled
 * Plugin UI package owns the matching provider marker; neither side publishes
 * it as plugin-author API.
 */
export const PLUGIN_UI_PRIVATE_SURFACE_ENTRY_PROVIDER_KEY = Symbol.for(
    'happier.pluginUi.privateSurfaceEntryProvider.v1',
);

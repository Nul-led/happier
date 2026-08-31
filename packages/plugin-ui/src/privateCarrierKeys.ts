/**
 * Cooperative cross-copy markers used by the SDK bootstrap, bundled Plugin UI,
 * and mounted host. They are implementation hooks, not author API or
 * provenance/authority tokens.
 */
export const PLUGIN_UI_PRIVATE_HOSTED_WEB_ACCOUNT_DATA_TRANSPORT_KEY = Symbol.for(
  'happier.pluginUi.privateHostedWebAccountDataTransport.v1',
);

export const PLUGIN_UI_PRIVATE_MOUNTED_COMPOSER_REF_KEY = Symbol.for(
  'happier.pluginUi.privateMountedComposerRef.v1',
);

export const PLUGIN_UI_PRIVATE_SURFACE_ENTRY_PROVIDER_KEY = Symbol.for(
  'happier.pluginUi.privateSurfaceEntryProvider.v1',
);

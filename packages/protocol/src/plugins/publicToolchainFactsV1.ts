import { PLUGIN_RUNTIME_API_VERSION } from './manifest/v2.js';
import { PLUGIN_UI_HOST_API_VERSION_V1 } from './ui/hostApiDefinition.js';
import { PLUGIN_UI_ARTIFACT_GRAMMAR_VERSION_V2 } from './ui/uiArtifactsManifest.js';

/** Executable Protocol-owned facts consumed by the public authoring packet. */
export const PUBLIC_TOOLCHAIN_PROTOCOL_FACTS_V1 = Object.freeze({
  runtimeApiVersion: PLUGIN_RUNTIME_API_VERSION,
  ui: Object.freeze({
    artifactGrammarVersion: PLUGIN_UI_ARTIFACT_GRAMMAR_VERSION_V2,
    hostApiVersion: PLUGIN_UI_HOST_API_VERSION_V1,
  }),
});

import type { PluginReactNativeLoaderBackend } from './loader';
import { createPluginUiCommonJsLoaderBackend } from './commonJsLoaderBackend';

/** Web, iOS, and Android consume the same universal CommonJS artifact. */
export function resolveDefaultReactNativeLoaderBackend(): PluginReactNativeLoaderBackend {
    return createPluginUiCommonJsLoaderBackend();
}

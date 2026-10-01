import { CHANNELS_PLUGIN } from './manifest.js';

/**
 * The universal CJS migration entry is callable so the host can evaluate it
 * without activating the plugin. Both declarations and callbacks are projected
 * from the one authored `definePlugin` value.
 */
export function collectionMigrations() {
  return Object.freeze({
    manifest: CHANNELS_PLUGIN.manifest,
    collectionMigrations: CHANNELS_PLUGIN.collectionMigrations,
  });
}

/**
 * Workspace packages the CLI host shares with its bundled plugins at runtime.
 *
 * First-party plugin daemon bundles leave these imports external, so a plugin
 * resolves them from the packaged dependency closure (`node_modules`). The
 * Node CLI host build must leave them external too: when the host inlines its
 * own copy, the daemon evaluates two module instances of each package, which
 * doubles the protocol's module-level Zod schema graph (measured at roughly
 * 600 MB per instance) and gives host and plugins different schema identities.
 *
 * The Bun-compiled binary still embeds its host copy: Bun cannot resolve a bare
 * external specifier from its embedded `/$bunfs` root, so these packages are
 * not Bun externals.
 */
export const PLUGIN_HOST_SHARED_RUNTIME_PACKAGES = Object.freeze([
  '@happier-dev/plugin-sdk',
  '@happier-dev/protocol',
]);

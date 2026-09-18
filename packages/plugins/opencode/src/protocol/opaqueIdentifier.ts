/**
 * The one OpenCode-plugin owner of the opaque-identifier rule.
 *
 * An id OpenCode minted -- a session, message or tool-call id -- is handed back
 * to OpenCode verbatim, so leading/trailing whitespace, embedded newlines, `/`,
 * `+`, `=` and non-ASCII bytes are part of the identity. Presence is decided by
 * a predicate; the accepted value keeps its exact bytes.
 *
 * This mirrors Protocol's `readNonBlankOpaqueIdentifier`, which is the canonical
 * host-side owner. It is duplicated here for a package-boundary reason, not a
 * missing abstraction: a shipped plugin source may reach no Happier workspace
 * package except `@happier-dev/plugin-sdk` and `@happier-dev/plugin-ui`, which
 * `packages/plugin-sdk/src/firstPartyPluginProtocolImportFence.test.ts` pins at
 * zero host-package reaches. Protocol is therefore unreachable from here, and
 * publishing the helper as a new public Plugin SDK export would add a second
 * public API owner for a rule Protocol already owns.
 *
 * So this module is the single OpenCode-scoped delegate: one implementation,
 * every consumer imported from here (directly, or through the
 * `agent/runtime/server/openCodeParsing.ts` re-export of this same symbol).
 * `opaqueIdentifier.test.ts` pins both halves — byte-for-byte parity with the
 * Protocol owner, and that no shipped OpenCode source declares a second copy.
 * Do not add a per-file predicate, and do not re-normalize these bytes.
 *
 * Happier-owned strings -- homes, paths, labels, backend modes, server URLs --
 * keep their own canonicalization and must not be routed through here.
 */
export function readNonBlankOpaqueIdentifier(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

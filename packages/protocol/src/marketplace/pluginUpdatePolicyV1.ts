import { z } from 'zod';

/**
 * The one plugin update policy, for every surface that declares, transports,
 * reviews, or persists it: a marketplace listing, the installation review a
 * human decides on, the daemon change contract, and the installed trust
 * record.
 *
 * `pinned` blocks updates; `reviewEveryUpdate` reviews every update;
 * `reviewSensitiveChanges` applies an explicit update without a new review
 * only while the reviewed npm registry/package ownership channel is preserved and
 * no review-sensitive trust fact changed. There are no aliases and no
 * surface-local variants.
 */
export const PluginUpdatePolicyV1Schema = z.enum([
  'pinned',
  'reviewEveryUpdate',
  'reviewSensitiveChanges',
]);
export type PluginUpdatePolicyV1 = z.infer<typeof PluginUpdatePolicyV1Schema>;

import { z } from 'zod';

export const HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD = 'daemon.plugins.install.review.decide' as const;

export const HostPrivatePluginInstallOptionalSelectionV1Schema = z.object({
  accessId: z.string().trim().min(1).max(256),
  selected: z.boolean(),
}).strict();

/**
 * A decision names the daemon-issued pending change it answers and nothing
 * about its own author. The daemon authenticates this RPC and resolves the
 * pending change itself, so a caller-supplied actor, interaction id, or
 * timestamp would be self-asserted rather than evidence; approval and
 * selection times come from the daemon clock at apply time.
 */
const HostPrivatePluginInstallPositiveDecisionV1Schema = z.object({
  v: z.literal(1),
  pendingChangeId: z.string().trim().min(1).max(256),
  decision: z.literal('installAndTrust'),
  optionalSelections: z.array(HostPrivatePluginInstallOptionalSelectionV1Schema).max(128),
}).strict().superRefine((value, context) => {
  const accessIds = new Set<string>();
  for (const selection of value.optionalSelections) {
    if (accessIds.has(selection.accessId)) {
      context.addIssue({
        code: 'custom',
        message: 'optionalSelections must contain unique accessId values',
        path: ['optionalSelections'],
      });
      return;
    }
    accessIds.add(selection.accessId);
  }
});

/**
 * Authorizes the daemon to evaluate executable plugin code from a local
 * development source root.
 *
 * This is a different authorization from `installAndTrust`: it grants no
 * optional host access and commits no plugin. It advances a pending
 * source-root review to the ordinary install-and-trust review the daemon
 * change service already owns, so the decision vocabulary here matches the
 * one at `apps/cli/src/plugins/daemon/changeContract.ts`
 * (`PluginChangeDecision`) rather than adding a second one.
 */
const HostPrivatePluginInstallTrustSourceRootDecisionV1Schema = z.object({
  v: z.literal(1),
  pendingChangeId: z.string().trim().min(1).max(256),
  decision: z.literal('trustSourceRoot'),
}).strict();

const HostPrivatePluginInstallCancelDecisionV1Schema = z.object({
  v: z.literal(1),
  pendingChangeId: z.string().trim().min(1).max(256),
  decision: z.literal('cancel'),
}).strict();

export const HostPrivatePluginInstallDecisionV1Schema = z.union([
  HostPrivatePluginInstallPositiveDecisionV1Schema,
  HostPrivatePluginInstallTrustSourceRootDecisionV1Schema,
  HostPrivatePluginInstallCancelDecisionV1Schema,
]);

export type HostPrivatePluginInstallDecisionV1 = z.infer<typeof HostPrivatePluginInstallDecisionV1Schema>;

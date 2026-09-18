import { z } from 'zod';

import {
  BuiltInLegacyConnectedServiceBindingsV1IngressSchema,
  ConnectedAccountServiceKeySchema,
  ConnectedServiceBindingSelectionV1Schema,
  ConnectedServiceBindingsV1Schema,
  TeamResourceBrokeredConnectedServiceSelectionV2Schema,
  TeamResourceDirectConnectedServiceSelectionV2Schema,
  type ConnectedServiceBindingsV1,
} from '../../connect/connectedServiceBindings.js';
import {
  QualifiedConnectedAccountPurposeBindingsV1Schema,
  type QualifiedConnectedAccountPurposeBindingsV1,
} from '../../connect/connectedAccountPurposeBindings.js';

const AgentIdSettingsKeySchema = z.string().trim().min(1);

const ConnectedServicesDefaultAuthTeamResourceQualifierV2Shape = {
  serverId: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  teamId: z.string().trim().min(1),
  expectedResourceRevision: z.number().int().nonnegative(),
} as const;

export const ConnectedServicesDefaultAuthTeamResourceBindingV2Schema = z.union([
  TeamResourceBrokeredConnectedServiceSelectionV2Schema.extend(
    ConnectedServicesDefaultAuthTeamResourceQualifierV2Shape,
  ),
  TeamResourceDirectConnectedServiceSelectionV2Schema.extend(
    ConnectedServicesDefaultAuthTeamResourceQualifierV2Shape,
  ),
]);
export type ConnectedServicesDefaultAuthTeamResourceBindingV2 = z.infer<
  typeof ConnectedServicesDefaultAuthTeamResourceBindingV2Schema
>;

const ConnectedServicesDefaultAuthBindingsByServiceIdV2Schema = z.record(
  z.string(),
  z.union([
    ConnectedServiceBindingSelectionV1Schema,
    ConnectedServicesDefaultAuthTeamResourceBindingV2Schema,
  ]),
).superRefine((bindings, context) => {
  for (const serviceId of Object.keys(bindings)) {
    if (ConnectedAccountServiceKeySchema.safeParse(serviceId).success) continue;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid qualified Connected Account service key',
      path: [serviceId],
    });
  }
});

export const ConnectedServicesDefaultAuthBindingsV2Schema = z.object({
  v: z.literal(2),
  bindingsByServiceId: ConnectedServicesDefaultAuthBindingsByServiceIdV2Schema.default({}),
}).strict();
export type ConnectedServicesDefaultAuthBindingsV2 = z.infer<
  typeof ConnectedServicesDefaultAuthBindingsV2Schema
>;

const ConnectedServicesDefaultAuthBindingsIngressSchema = z.union([
  ConnectedServicesDefaultAuthBindingsV2Schema,
  ConnectedServiceBindingsV1Schema,
]);

export const ConnectedServicesDefaultAuthByAgentIdV1Schema = z
  .object({
    v: z.literal(1).default(1),
    bindingsByAgentId: z.record(AgentIdSettingsKeySchema, ConnectedServicesDefaultAuthBindingsIngressSchema).default({}),
  })
  .strict();

/** Released bundled account settings used scalar service ids before qualified service identity. */
const BuiltInLegacyConnectedServicesDefaultAuthByAgentIdV1Schema = z
  .object({
    v: z.literal(1).default(1),
    bindingsByAgentId: z.record(
      AgentIdSettingsKeySchema,
      BuiltInLegacyConnectedServiceBindingsV1IngressSchema,
    ).default({}),
  })
  .strict()
  .transform((value) => ConnectedServicesDefaultAuthByAgentIdV1Schema.parse(value));

export const BuiltInLegacyConnectedServicesDefaultAuthByAgentIdV1IngressSchema = z
  .union([
    ConnectedServicesDefaultAuthByAgentIdV1Schema,
    BuiltInLegacyConnectedServicesDefaultAuthByAgentIdV1Schema,
  ])
  .catch({ v: 1 as const, bindingsByAgentId: {} });

export type ConnectedServicesDefaultAuthByAgentIdV1 = z.infer<
  typeof ConnectedServicesDefaultAuthByAgentIdV1Schema
>;

export const DEFAULT_CONNECTED_SERVICES_DEFAULT_AUTH_BY_AGENT_ID_V1:
  ConnectedServicesDefaultAuthByAgentIdV1 =
    ConnectedServicesDefaultAuthByAgentIdV1Schema.parse({});

export const DEFAULT_CONNECTED_ACCOUNT_PURPOSE_BINDINGS_V1:
  QualifiedConnectedAccountPurposeBindingsV1 =
    QualifiedConnectedAccountPurposeBindingsV1Schema.parse({ v: 1, bindings: [] });

export const ConnectedServicesProviderConfigSharingModeV1Schema = z.enum([
  'linked',
  'copied',
  'isolated',
]);

export type ConnectedServicesProviderConfigSharingModeV1 = z.infer<
  typeof ConnectedServicesProviderConfigSharingModeV1Schema
>;

export const ConnectedServicesProviderStateSharingModeV1Schema = z.enum([
  'isolated',
  'shared',
]);

export type ConnectedServicesProviderStateSharingModeV1 = z.infer<
  typeof ConnectedServicesProviderStateSharingModeV1Schema
>;

export const ConnectedServicesProviderStateSharingPolicyV1Schema = z
  .object({
    configMode: ConnectedServicesProviderConfigSharingModeV1Schema.default('linked'),
    // Default to shared session state: most users connect multiple accounts for
    // usage/quota and expect their provider sessions to continue across accounts.
    // Turning this off (via `defaults.stateMode` or a per-agent `byAgentId`
    // override) is the opt-out. Providers whose descriptor reports
    // `state.supported: false` ignore `shared` and stay isolated.
    stateMode: ConnectedServicesProviderStateSharingModeV1Schema.default('shared'),
  })
  .strict();

export type ConnectedServicesProviderStateSharingPolicyV1 = z.infer<
  typeof ConnectedServicesProviderStateSharingPolicyV1Schema
>;

const ConnectedServicesProviderStateSharingOverrideV1Schema = z
  .object({
    configMode: ConnectedServicesProviderConfigSharingModeV1Schema.optional(),
    stateMode: ConnectedServicesProviderStateSharingModeV1Schema.optional(),
  })
  .strict();

const ConnectedServicesProviderStateSharingRiskAcknowledgementV1Schema = z
  .object({
    sharedStatePrivacy: z.boolean().optional(),
    symlinkUnavailable: z.boolean().optional(),
  })
  .strict();

export const ConnectedServicesProviderStateSharingSettingsV1Schema = z
  .object({
    v: z.literal(1).default(1),
    defaults: ConnectedServicesProviderStateSharingPolicyV1Schema.default({
      configMode: 'linked',
      stateMode: 'shared',
    }),
    byAgentId: z
      .record(AgentIdSettingsKeySchema, ConnectedServicesProviderStateSharingOverrideV1Schema)
      .default({}),
    acknowledgedRisksByAgentId: z
      .record(AgentIdSettingsKeySchema, ConnectedServicesProviderStateSharingRiskAcknowledgementV1Schema)
      .default({}),
  })
  .strict()
  .catch({
    v: 1,
    defaults: {
      configMode: 'linked',
      stateMode: 'shared',
    },
    byAgentId: {},
    acknowledgedRisksByAgentId: {},
  });

export type ConnectedServicesProviderStateSharingSettingsV1 = z.infer<
  typeof ConnectedServicesProviderStateSharingSettingsV1Schema
>;

export const DEFAULT_CONNECTED_SERVICES_PROVIDER_STATE_SHARING_SETTINGS_V1:
  ConnectedServicesProviderStateSharingSettingsV1 =
    ConnectedServicesProviderStateSharingSettingsV1Schema.parse({});

export function resolveConnectedServicesProviderStateSharingPolicyV1(
  settingsLike: unknown,
  agentId: string,
): ConnectedServicesProviderStateSharingPolicyV1 {
  const settings = ConnectedServicesProviderStateSharingSettingsV1Schema.parse(settingsLike);
  const override = settings.byAgentId[agentId];
  return {
    configMode: override?.configMode ?? settings.defaults.configMode,
    stateMode: override?.stateMode ?? settings.defaults.stateMode,
  };
}

export type ConnectedServicesDefaultAuthBindingByAgentIdV1 = Record<
  string,
  ConnectedServiceBindingsV1 | ConnectedServicesDefaultAuthBindingsV2
>;

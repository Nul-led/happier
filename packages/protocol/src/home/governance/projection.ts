import { z } from 'zod';

import { HomeCapabilitiesV1Schema } from './capabilities.js';
import {
  HomeAdmissionModeV1Schema,
  HomeIdentityNetworkPolicyV1Schema,
  HomeTeamProviderPolicyV1Schema,
  ManagedIdentityProviderKindV1Schema,
  TeamCreationPolicyV1Schema,
} from './policy.js';
import { AccountStatusV1Schema, HomeRoleV1Schema } from './roles.js';
import { AccountEncryptionModeSchema } from '../../features/payload/capabilities/encryptionCapabilities.js';

/**
 * Whether this Home has an active owner. `setup_required` is a bootstrap state
 * that only the zero-owner claim service can leave; ordinary UI explains it and
 * never offers a public claim action.
 */
export const HomeGovernanceSetupStateV1Schema = z.enum(['owned', 'setup_required']);
export type HomeGovernanceSetupStateV1 = z.infer<typeof HomeGovernanceSetupStateV1Schema>;

/**
 * The authentication narrowing as the administration surface sees it. It
 * mirrors the stored document's read result so an unreadable configuration is
 * rendered as an actionable problem instead of silently inherited.
 */
export const HomeAuthenticationPolicyProjectionV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('inherited') }).strict(),
  z.object({
    status: z.literal('narrowed'),
    enabledMethodIds: z.array(z.string().min(1)).nullable(),
    permittedAccountModes: z.array(z.enum(['e2ee', 'plain'])).nullable(),
    recommendedProvisioningMode: z.enum(['e2ee', 'plain']).nullable(),
    admission: HomeAdmissionModeV1Schema.nullable(),
    signInServiceDisabled: z.boolean(),
  }).strict(),
  z.object({ status: z.literal('unreadable') }).strict(),
]);

export type HomeAuthenticationPolicyProjectionV1 = z.infer<typeof HomeAuthenticationPolicyProjectionV1Schema>;

const HomeTeamProviderPolicyProjectionV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('inherited') }).strict(),
  z.object({ status: z.literal('narrowed'), policy: HomeTeamProviderPolicyV1Schema }).strict(),
  z.object({ status: z.literal('unreadable') }).strict(),
]);

const HomeIdentityNetworkPolicyProjectionV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('inherited') }).strict(),
  z.object({ status: z.literal('narrowed'), policy: HomeIdentityNetworkPolicyV1Schema }).strict(),
  z.object({ status: z.literal('unreadable') }).strict(),
]);

export const HomeGovernancePolicyProjectionV1Schema = z.object({
  revision: z.number().int().min(0),
  teamCreationPolicy: TeamCreationPolicyV1Schema,
  authentication: HomeAuthenticationPolicyProjectionV1Schema,
  teamProviders: HomeTeamProviderPolicyProjectionV1Schema.optional(),
  identityNetwork: HomeIdentityNetworkPolicyProjectionV1Schema.optional(),
}).strict();

export type HomeGovernancePolicyProjectionV1 = z.infer<typeof HomeGovernancePolicyProjectionV1Schema>;

/**
 * The deployment-owned identity facts a Home administrator can see but never
 * change from this Home.
 *
 * They exist because two administration answers are otherwise unexplainable:
 * why WorkOS setup is offered or refused, and why a private identity endpoint
 * can or cannot be allowed here. Both are decided by the operator's runtime
 * configuration, so the projection reports the resulting capability and never
 * the environment variable names, keys or hosts behind it.
 */
export const HomeIdentityDeploymentServicesV1Schema = z.object({
  workos: z.enum(['configured', 'partially_configured', 'not_configured']),
  privateIdentityNetworkAllowed: z.boolean(),
  /**
   * The Team identity-provider kinds this deployment can run: the ceiling an
   * inherited Home policy resolves to and the only kinds a Home may add when it
   * saves a narrowing. The policy editor seeds from it, never from the enum.
   */
  teamProviderKinds: z.array(ManagedIdentityProviderKindV1Schema),
}).strict();

export type HomeIdentityDeploymentServicesV1 = z.infer<typeof HomeIdentityDeploymentServicesV1Schema>;

export const HomeAuthenticationOptionsV1Schema = z.object({
  methods: z.array(z.object({
    id: z.string().min(1),
    displayName: z.string().min(1).optional(),
    iconHint: z.string().nullable().optional(),
    actions: z.array(z.object({
      id: z.enum(['login', 'provision', 'connect']),
      enabled: z.boolean(),
      mode: z.enum(['keyed', 'keyless', 'either']),
      reason: z.enum([
        'method_not_enabled',
        'provisioning_not_enabled',
        'account_mode_unavailable',
        'email_delivery_unavailable',
      ]).optional(),
    }).strict()),
  }).strict()),
  permittedAccountModes: z.array(AccountEncryptionModeSchema).min(1),
  recommendedProvisioningMode: AccountEncryptionModeSchema.nullable(),
  signInService: z.object({
    deploymentMode: z.enum(['disabled', 'self', 'external']).nullable(),
    canDisable: z.boolean(),
  }).strict(),
}).strict();

export type HomeAuthenticationOptionsV1 = z.infer<typeof HomeAuthenticationOptionsV1Schema>;

/**
 * The Home Administration snapshot for one explicit Home and one viewer.
 *
 * `activeOwnerCount` backs the last-owner explanation before submission; the
 * transaction remains the decisive authority.
 */
export const HomeGovernanceProjectionV1Schema = z.object({
  viewer: z.object({
    accountId: z.string().min(1),
    homeRole: HomeRoleV1Schema,
    status: AccountStatusV1Schema,
  }).strict(),
  capabilities: HomeCapabilitiesV1Schema,
  policy: HomeGovernancePolicyProjectionV1Schema,
  setupState: HomeGovernanceSetupStateV1Schema,
  activeOwnerCount: z.number().int().min(0),
  teamsEnabled: z.boolean(),
  // Optional for the same reason as the policy reads above: a Home that has not
  // been replaced yet simply does not report these facts, and the surface shows
  // the section as unavailable instead of inventing a deployment answer.
  identityServices: HomeIdentityDeploymentServicesV1Schema.optional(),
  authenticationOptions: HomeAuthenticationOptionsV1Schema,
}).strict();

export type HomeGovernanceProjectionV1 = z.infer<typeof HomeGovernanceProjectionV1Schema>;

/** The complete non-administrative Home projection available to any active viewer. */
export const HomeGovernanceEligibilityV1Schema = z.object({
  teamsEnabled: z.boolean(),
  createTeam: z.boolean(),
}).strict();

export type HomeGovernanceEligibilityV1 = z.infer<typeof HomeGovernanceEligibilityV1Schema>;

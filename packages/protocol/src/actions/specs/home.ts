import {
  HomeAccountDeleteResultV1Schema,
  HomeAccountListInputV1Schema,
  HomeAccountListResultV1Schema,
  HomeAccountRoleSetInputV1Schema,
  HomeAccountRowV1Schema,
  HomeAccountSearchInputV1Schema,
  HomeAccountSearchResultV1Schema,
  HomeAccountTargetInputV1Schema,
} from '../../home/governance/accounts.js';
import {
  HomeGovernanceEligibilityGetInputV1Schema,
  HomeGovernanceGetInputV1Schema,
} from '../../home/governance/actionsV1.js';
import { HomeGovernancePolicySetInputV1Schema } from '../../home/governance/policy.js';
import {
  HomeGovernancePolicyProjectionV1Schema,
  HomeGovernanceEligibilityV1Schema,
  HomeGovernanceProjectionV1Schema,
} from '../../home/governance/projection.js';
import type { PreNormalizedActionSpec } from '../actionSpecs.js';
import { homeDomainActionRow, homeDomainApprovalField as approvalField } from './homeDomainRow.js';

const ACCOUNT_ID_FIELD = approvalField('accountId', 'Account ID', { required: true });

/**
 * Home Administration rows.
 *
 * They are core Home behavior, not a gated capability: a Home that understands
 * these operations must serve them whether or not Teams is enabled, because
 * Account status and Home role enforcement are the Home's own authority.
 *
 * Role, Disable and Re-enable answer with the Account row the Home now holds, so
 * a same-state mutation reports the unchanged current Account rather than an
 * acknowledgement the caller would have to re-read to trust.
 */
export const HOME_GOVERNANCE_ACTION_SPECS = Object.freeze([
  homeDomainActionRow({
    id: 'home.governance.get',
    title: 'Get Home administration',
    description: 'Read this Home\'s governance projection for the authenticated Account.',
    safety: 'safe',
    sideEffectClass: 'read',
    cliPath: ['home', 'governance', 'get'],
    path: '/v1/home/governance/get',
    inputSchema: HomeGovernanceGetInputV1Schema,
    outputSchema: HomeGovernanceProjectionV1Schema,
  }),
  homeDomainActionRow({
    id: 'home.governance.eligibility.get',
    title: 'Get Home eligibility',
    description: 'Read only Teams availability and this Account\'s effective Team-creation eligibility.',
    safety: 'safe',
    sideEffectClass: 'read',
    cliPath: ['home', 'governance', 'eligibility', 'get'],
    path: '/v1/home/governance/eligibility/get',
    inputSchema: HomeGovernanceEligibilityGetInputV1Schema,
    outputSchema: HomeGovernanceEligibilityV1Schema,
  }),
  homeDomainActionRow({
    id: 'home.accounts.list',
    title: 'List Home Accounts',
    description: 'Page through the Home People list as a Home administrator.',
    safety: 'safe',
    sideEffectClass: 'read',
    cliPath: ['home', 'accounts', 'list'],
    path: '/v1/home/accounts/list',
    inputSchema: HomeAccountListInputV1Schema,
    outputSchema: HomeAccountListResultV1Schema,
  }),
  homeDomainActionRow({
    id: 'home.accounts.search',
    title: 'Search Home Accounts',
    description: 'Resolve people for an exact Home or Team scope without reading Home administration.',
    safety: 'safe',
    sideEffectClass: 'read',
    cliPath: ['home', 'accounts', 'search'],
    path: '/v1/home/accounts/search',
    inputSchema: HomeAccountSearchInputV1Schema,
    outputSchema: HomeAccountSearchResultV1Schema,
    inputHints: { fields: [
      approvalField('query', 'Search query', { required: true }),
      approvalField('scope.kind', 'Scope', { required: true }),
      approvalField('scope.teamId', 'Team ID'),
    ] },
  }),
  homeDomainActionRow({
    id: 'home.accounts.role.set',
    title: 'Set Home role',
    description: 'Change one Account\'s Home role. The Home enforces its last-owner invariant.',
    safety: 'danger',
    sideEffectClass: 'danger',
    cliPath: ['home', 'accounts', 'role', 'set'],
    path: '/v1/home/accounts/role/set',
    inputSchema: HomeAccountRoleSetInputV1Schema,
    outputSchema: HomeAccountRowV1Schema,
    inputHints: { fields: [
      ACCOUNT_ID_FIELD,
      approvalField('homeRole', 'Home role', { required: true }),
    ] },
  }),
  homeDomainActionRow({
    id: 'home.accounts.disable',
    title: 'Disable Home Account',
    description: 'Place one Account on a reversible hold, ending its access to this Home.',
    safety: 'danger',
    sideEffectClass: 'danger',
    cliPath: ['home', 'accounts', 'disable'],
    path: '/v1/home/accounts/disable',
    inputSchema: HomeAccountTargetInputV1Schema,
    outputSchema: HomeAccountRowV1Schema,
    inputHints: { fields: [ACCOUNT_ID_FIELD] },
  }),
  homeDomainActionRow({
    id: 'home.accounts.enable',
    title: 'Re-enable Home Account',
    description: 'Lift a reversible hold and restore one Account\'s access to this Home.',
    safety: 'danger',
    sideEffectClass: 'danger',
    cliPath: ['home', 'accounts', 'enable'],
    path: '/v1/home/accounts/enable',
    inputSchema: HomeAccountTargetInputV1Schema,
    outputSchema: HomeAccountRowV1Schema,
    inputHints: { fields: [ACCOUNT_ID_FIELD] },
  }),
  homeDomainActionRow({
    id: 'home.accounts.delete',
    title: 'Delete Home Account',
    description: 'Erase one Account through the Home\'s single erasure owner. Incomplete cleanup is reported explicitly.',
    safety: 'danger',
    sideEffectClass: 'danger',
    cliPath: ['home', 'accounts', 'delete'],
    path: '/v1/home/accounts/delete',
    inputSchema: HomeAccountTargetInputV1Schema,
    outputSchema: HomeAccountDeleteResultV1Schema,
    inputHints: { fields: [ACCOUNT_ID_FIELD] },
  }),
  homeDomainActionRow({
    id: 'home.policy.set',
    title: 'Set Home policy',
    description: 'Update this Home\'s governance policy against the revision the caller last read.',
    safety: 'danger',
    sideEffectClass: 'danger',
    cliPath: ['home', 'policy', 'set'],
    path: '/v1/home/policy/set',
    inputSchema: HomeGovernancePolicySetInputV1Schema,
    outputSchema: HomeGovernancePolicyProjectionV1Schema,
    inputHints: { fields: [
      approvalField('expectedRevision', 'Expected revision', { widget: 'integer', required: true }),
      approvalField('teamCreationPolicy', 'Team creation policy'),
      approvalField('authenticationPolicy.enabledMethodIds', 'Enabled sign-in methods', { widget: 'text_list', listSeparator: 'comma' }),
      approvalField('authenticationPolicy.permittedAccountModes', 'Permitted Account modes', { widget: 'text_list', listSeparator: 'comma' }),
      approvalField('authenticationPolicy.recommendedProvisioningMode', 'Recommended Account mode'),
      approvalField('authenticationPolicy.admission', 'Account admission'),
      approvalField('authenticationPolicy.signInService.mode', 'Sign-in service'),
      approvalField('teamProviderPolicy.allowedTeamProviderKinds', 'Allowed Team provider kinds', { widget: 'text_list', listSeparator: 'comma' }),
      approvalField('teamProviderPolicy.teamJitAllowed', 'Team JIT allowed', { widget: 'boolean' }),
      approvalField('teamProviderPolicy.approvedGitHubEnterpriseOrigins', 'Approved GitHub Enterprise origins', { widget: 'text_list', listSeparator: 'comma' }),
      approvalField('identityNetworkPolicy.mode', 'Identity network mode'),
      approvalField('identityNetworkPolicy.hostnames', 'Allowed hostnames', { widget: 'text_list', listSeparator: 'comma' }),
      approvalField('identityNetworkPolicy.cidrs', 'Allowed CIDRs', { widget: 'text_list', listSeparator: 'comma' }),
      approvalField('identityNetworkPolicy.ports', 'Allowed ports', { widget: 'text_list', listSeparator: 'comma' }),
    ] },
  }),
]) satisfies readonly PreNormalizedActionSpec[];

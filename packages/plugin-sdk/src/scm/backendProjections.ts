import {
    ScmBackendCapabilitiesSchema as canonicalScmBackendCapabilitiesSchema,
    ScmBackendContributionSchema as canonicalScmBackendContributionSchema,
    createScmCapabilitiesFromBackendCapabilities as canonicalCreateScmCapabilitiesFromBackendCapabilities,
    mapGitScmErrorCode as canonicalMapGitScmErrorCode,
    mapSaplingScmErrorCode as canonicalMapSaplingScmErrorCode,
    supportedCapability as canonicalSupportedCapability,
    unsupportedCapability as canonicalUnsupportedCapability,
    resolveScmBackendCapabilities as canonicalResolveScmBackendCapabilities,
} from '@happier-dev/protocol/scm';

import type {
    ScmBackendCapabilities,
    ScmBackendCapabilityLeaf,
    ScmBackendCapabilityUnavailableReason,
    ScmBackendContribution,
} from './backend.js';
import type {
    ScmCapabilities,
    ScmOperationErrorCode,
    ScmRefreshPolicy,
    ScmRepoMode,
} from './projections.js';

/** Resolve declaration availability through the shared SCM policy owner. */
export const resolveScmBackendCapabilities: (input: Readonly<{
    declaredCapabilities: ScmBackendCapabilities;
    mode: ScmRepoMode | null;
    supportedRepoModes?: readonly ScmRepoMode[];
    executableAvailable?: boolean;
    freshness?: Readonly<{
        state?: ScmBackendCapabilities['freshness']['state'];
        refreshPolicy?: ScmRefreshPolicy;
    }>;
}>) => ScmBackendCapabilities = canonicalResolveScmBackendCapabilities;

/** Canonical Protocol validators with SDK-local declaration contracts. */
export const ScmBackendCapabilitiesSchema: {
    parse(value: unknown): ScmBackendCapabilities;
    safeParse(value: unknown):
        | Readonly<{ success: true; data: ScmBackendCapabilities }>
        | Readonly<{ success: false; error: unknown }>;
} = canonicalScmBackendCapabilitiesSchema;
export const ScmBackendContributionSchema: {
    parse(value: unknown): ScmBackendContribution;
    safeParse(value: unknown):
        | Readonly<{ success: true; data: ScmBackendContribution }>
        | Readonly<{ success: false; error: unknown }>;
} = canonicalScmBackendContributionSchema;

export const createScmCapabilitiesFromBackendCapabilities: (
    input: ScmBackendCapabilities,
    overrides?: Partial<ScmCapabilities>,
) => ScmCapabilities = canonicalCreateScmCapabilitiesFromBackendCapabilities;

export const mapGitScmErrorCode: (stderr: string) => ScmOperationErrorCode =
    canonicalMapGitScmErrorCode;
export const mapSaplingScmErrorCode: (stderr: string) => ScmOperationErrorCode =
    canonicalMapSaplingScmErrorCode;
export const supportedCapability: () => ScmBackendCapabilityLeaf = canonicalSupportedCapability;
export const unsupportedCapability: (
    reason?: ScmBackendCapabilityUnavailableReason,
) => ScmBackendCapabilityLeaf = canonicalUnsupportedCapability;

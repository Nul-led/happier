import { z } from 'zod';

import { HomeConnectionDescriptorV1Schema, type HomeConnectionDescriptorV1 } from '../../auth/accountDirectory.js';
import { CapabilitiesSchema, type Capabilities } from './capabilities/capabilitiesSchema.js';
import { FeatureGatesSchema, type FeatureGates } from './featureGatesSchema.js';
import { isRecord } from './isRecord.js';
import { coerceBugReportsCapabilitiesFromFeaturesPayload } from './capabilities/bugReportsCapabilities.js';

/**
 * Maximum encoded `/v1/features` response accepted before JSON parsing.
 * The response is a bounded capability document, and clients enforce this
 * receive-memory boundary while streaming rather than trusting Content-Length.
 */
export const FEATURES_RESPONSE_MAX_UTF8_BYTES_V1 = 1024 * 1024;

function coerceFeaturesResponsePayload(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;

  // Robustness: malformed bugReports capabilities must not invalidate unrelated feature gates.
  // Coerce it to a safe default while preserving the rest of the payload.
  const next = { ...raw } as Record<string, unknown>;
  if (!isRecord(next.capabilities)) {
    next.capabilities = {};
  }

  // Robustness: missing voice enabled bits must be treated as disabled rather than invalidating the payload.
  if (isRecord(next.features)) {
    const features = { ...(next.features as Record<string, unknown>) };
    const voice = features.voice;
    if (isRecord(voice)) {
      const coercedVoice: Record<string, unknown> = { ...voice };
      if (typeof coercedVoice.enabled !== 'boolean') {
        coercedVoice.enabled = false;
      }
      const happierVoice = coercedVoice.happierVoice;
      if (isRecord(happierVoice)) {
        const coercedHappierVoice: Record<string, unknown> = { ...happierVoice };
        if (typeof coercedHappierVoice.enabled !== 'boolean') {
          coercedHappierVoice.enabled = false;
        }
        coercedVoice.happierVoice = coercedHappierVoice;
      }
      features.voice = coercedVoice;
      next.features = features;
    }
  }

  return {
    ...next,
    capabilities: {
      ...(next.capabilities as Record<string, unknown>),
      bugReports: coerceBugReportsCapabilitiesFromFeaturesPayload(next),
    },
  };
}

export const FeaturesResponseSchema = z.preprocess(
  coerceFeaturesResponsePayload,
  z.object({
    features: FeatureGatesSchema,
    capabilities: CapabilitiesSchema,
    // Additive optional Home connection descriptor (Home Iroh publication):
    // old servers omit the field and remain valid; a present field must parse
    // through the one canonical outer descriptor schema or the response fails.
    homeConnectionDescriptor: HomeConnectionDescriptorV1Schema.optional(),
  }),
);

export type FeaturesResponse = Readonly<{
  features: FeatureGates;
  capabilities: Capabilities;
  homeConnectionDescriptor?: HomeConnectionDescriptorV1;
}>;

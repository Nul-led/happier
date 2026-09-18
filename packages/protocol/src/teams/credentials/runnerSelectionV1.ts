import { z } from 'zod';

import { ProviderBrokerApplicationBindingV1Schema } from '../../providers/brokerRouteGrantV1.js';
import { RunnerConsentDisplayFactsV1Schema, RunnerCredentialSelectionBindingV1Schema } from '../../ephemeralRunner/review.js';
import { TeamCredentialProviderModelSelectionV1Schema } from './resourceV1.js';
import { SessionTeamCredentialBindingRejectionV1Schema } from './sessionBindingV1.js';

export const RunnerCredentialSelectionResolutionRequestV1Schema = z.object({
  v: z.literal(1),
  selection: TeamCredentialProviderModelSelectionV1Schema,
  application: ProviderBrokerApplicationBindingV1Schema,
  sourceRevision: z.string().min(1).max(512),
  plannedSession: z.object({
    primaryTeamId: z.string().min(1).nullable(),
    teamVisibilityTeamIds: z.array(z.string().min(1)).max(128),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.selection.agentTargetKey !== value.application.agentTargetKey) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['application', 'agentTargetKey'],
      message: 'Application must target the reviewed Agent',
    });
  }
});
export type RunnerCredentialSelectionResolutionRequestV1 = z.infer<
  typeof RunnerCredentialSelectionResolutionRequestV1Schema
>;

export const RunnerCredentialSelectionResolutionUnavailableReasonV1Schema = z.union([
  SessionTeamCredentialBindingRejectionV1Schema,
  z.enum([
    'activation_unavailable',
    'activation_conflict',
    'application_unavailable',
    'model_unavailable',
    'source_changed',
  ]),
]);
export type RunnerCredentialSelectionResolutionUnavailableReasonV1 = z.infer<
  typeof RunnerCredentialSelectionResolutionUnavailableReasonV1Schema
>;

export const RunnerCredentialSelectionResolutionResponseV1Schema = z.discriminatedUnion('status', [
  z.object({
    v: z.literal(1),
    status: z.literal('resolved'),
    credentialSelectionBinding: RunnerCredentialSelectionBindingV1Schema,
    displayFacts: RunnerConsentDisplayFactsV1Schema,
  }).strict(),
  z.object({
    v: z.literal(1),
    status: z.literal('unavailable'),
    reason: RunnerCredentialSelectionResolutionUnavailableReasonV1Schema,
  }).strict(),
]);
export type RunnerCredentialSelectionResolutionResponseV1 = z.infer<
  typeof RunnerCredentialSelectionResolutionResponseV1Schema
>;

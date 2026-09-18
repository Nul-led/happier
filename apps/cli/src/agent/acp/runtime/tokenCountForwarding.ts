import type { AgentSessionRuntimeEvent, SessionContextUsageSnapshotV1 } from '@happier-dev/protocol';

import {
  extractUsageObservationFromTokenCountMessage,
  type UsageObservation,
} from '../../../usage/usageObservation';
import { buildTokenCountSessionMessageFromUsageObservation } from '../../../usage/legacy/legacyUsageTransport';

/**
 * The measurement half of a canonical `usage-observed` runtime event: everything
 * the producer derives from the provider payload, without the host-owned
 * identity fields (`sequence`, `sessionId`, `emittedAtMs`, `observationId`,
 * `turnId`).
 */
export type UsageObservedRuntimeMeasurement = Readonly<Pick<
  Extract<AgentSessionRuntimeEvent, { kind: 'usage-observed' }>,
  'source' | 'scope' | 'modelId' | 'tokens' | 'cost' | 'context'
>>;

function clampTokenCountCostForForwarding(
  cost: UsageObservation['cost'],
): UsageObservation['cost'] {
  if (!cost?.breakdown) return cost;
  const breakdown = Object.fromEntries(Object.entries(cost.breakdown)
    .filter(([key]) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
    .filter(([key]) => key.trim().length > 0 && key.length <= 64)
    .slice(0, 20));
  const { breakdown: _unboundedBreakdown, ...semanticCost } = cost;
  return Object.keys(breakdown).length === 0 ? semanticCost : { ...semanticCost, breakdown };
}

function clampTokenCountTokensForForwarding(tokens: Record<string, number>): Record<string, number> {
  const MAX_KEYS = 32;
  const out = Object.create(null) as Record<string, number>;
  let count = 0;

  const priority: ReadonlyArray<string> = ['total', 'input', 'output', 'cache_creation', 'cache_read', 'thought'];
  for (const key of priority) {
    const value = tokens[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[key] = value;
      count++;
    }
  }

  const remaining = Object.keys(tokens)
    .filter((k) => !(k in out))
    .filter((k) => k.trim().length > 0 && k.length <= 64 && k !== '__proto__' && k !== 'constructor' && k !== 'prototype')
    .sort();

  for (const key of remaining) {
    if (count >= MAX_KEYS) break;
    const value = tokens[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    out[key] = value;
    count++;
  }

  if (out.total == null) {
    out.total =
      (out.input ?? 0) + (out.output ?? 0) + (out.cache_creation ?? 0) + (out.cache_read ?? 0) + (out.thought ?? 0);
  }

  return out;
}

export function buildTokenCountSessionMessageForForwarding(
  agentMessage: Record<string, unknown>,
): ReturnType<typeof buildTokenCountSessionMessageFromUsageObservation> | null {
  const observation = extractUsageObservationFromTokenCountMessage({
    provider: 'unknown',
    body: agentMessage,
  });
  if (!observation) return null;

  return buildTokenCountSessionMessageFromUsageObservation({
    ...observation,
    tokens: observation.tokens ? (clampTokenCountTokensForForwarding(observation.tokens) as any) : null,
    cost: clampTokenCountCostForForwarding(observation.cost),
  });
}

function truncateNonNegative(value: number): number {
  return Math.max(0, Math.trunc(value));
}

/**
 * The canonical runtime event carries context usage only as a full snapshot, so
 * a provider that reports bare used/window token counts needs one derived here.
 * A snapshot the provider supplied itself always wins.
 */
function resolveContextSnapshot(
  observation: UsageObservation,
  observedAtMs: number,
): SessionContextUsageSnapshotV1 | null {
  if (observation.contextSnapshot) return observation.contextSnapshot;
  if (observation.contextUsedTokens == null && observation.contextWindowTokens == null) return null;
  return {
    v: 1,
    modelId: observation.modelId,
    usedTokens: truncateNonNegative(observation.contextUsedTokens ?? 0),
    windowTokens: observation.contextWindowTokens == null
      ? null
      : truncateNonNegative(observation.contextWindowTokens),
    totalProcessedTokens: null,
    baselineTokens: null,
    isAutoCompactEnabled: null,
    categories: null,
    observedAtMs: truncateNonNegative(observedAtMs),
    source: 'provider_turn',
  };
}

/**
 * Projects a legacy `token_count` body onto the canonical `usage-observed`
 * measurement through the single usage-normalization owner, so the runtime
 * event carries the same tokens, cost and context the usage store and the
 * legacy transport already agree on.
 */
export function buildUsageObservedMeasurementFromTokenCountMessage(params: Readonly<{
  provider: string;
  body: unknown;
  observedAtMs: number;
  defaultSource?: string;
}>): UsageObservedRuntimeMeasurement | null {
  const observation = extractUsageObservationFromTokenCountMessage({
    provider: params.provider,
    body: params.body,
    ...(params.defaultSource ? { defaultSource: params.defaultSource } : {}),
  });
  if (!observation) return null;

  // The runtime event schema requires safe integers; the shared normalizer
  // tolerates the fractional counts some providers report.
  const tokens = observation.tokens
    ? {
        input: truncateNonNegative(observation.tokens.input),
        output: truncateNonNegative(observation.tokens.output),
        reasoning: truncateNonNegative(observation.tokens.reasoning),
        cacheRead: truncateNonNegative(observation.tokens.cacheRead),
        cacheWrite: truncateNonNegative(observation.tokens.cacheWrite),
        total: truncateNonNegative(observation.tokens.total),
      }
    : null;
  const context = resolveContextSnapshot(observation, params.observedAtMs);
  if (!tokens && !observation.cost && !context) return null;

  return {
    source: observation.source,
    scope: observation.scope,
    ...(observation.modelId ? { modelId: observation.modelId } : {}),
    ...(tokens ? { tokens } : {}),
    ...(observation.cost ? { cost: observation.cost } : {}),
    ...(context ? { context } : {}),
  };
}

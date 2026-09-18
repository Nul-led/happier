import type {
  ConnectedServiceQuotaLimitSelectionV1,
  ConnectedServiceQuotaMeterV1,
} from './connectedServiceSchemas.js';

function readQuotaLimitIdentity(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Resolves the stable allowance identity shared by policy authoring and enforcement. */
export function resolveConnectedServiceQuotaMeterLimitIdentity(
  meter: ConnectedServiceQuotaMeterV1,
): string {
  return readQuotaLimitIdentity(meter.providerLimitId) ?? meter.meterId;
}

/** Applies a Pool's selected provider allowance families without discarding account-level facts. */
export function selectConnectedServiceQuotaMetersForLimitSelection(
  meters: readonly ConnectedServiceQuotaMeterV1[],
  selection?: ConnectedServiceQuotaLimitSelectionV1,
): readonly ConnectedServiceQuotaMeterV1[] {
  if (!selection || selection.mode === 'all') return meters;
  const selectedIds = new Set(selection.providerLimitIds);
  return meters.filter((meter) => selectedIds.has(
    resolveConnectedServiceQuotaMeterLimitIdentity(meter),
  ));
}

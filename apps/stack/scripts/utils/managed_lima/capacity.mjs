function positiveInteger(value, label, errorPrefix) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`${errorPrefix} ${label} must be a positive integer`);
  }
  return normalized;
}

export function normalizeManagedLimaCapacity(
  raw,
  { subject = 'capacity', errorPrefix = '[managed-lima]' } = {},
) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${errorPrefix} ${subject} must be an object`);
  }
  const mode = String(raw.mode ?? '').trim().toLowerCase();
  if (mode !== 'shared' && mode !== 'dedicated') {
    throw new Error(`${errorPrefix} ${subject} mode must be "shared" or "dedicated"`);
  }
  const normalizePreset = (preset, name) => {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
      throw new Error(`${errorPrefix} ${subject} ${name} must be an object`);
    }
    return {
      cpus: positiveInteger(preset.cpus, `${subject} ${name} cpus`, errorPrefix),
      memoryGiB: positiveInteger(preset.memoryGiB, `${subject} ${name} memoryGiB`, errorPrefix),
    };
  };
  return {
    mode,
    shared: normalizePreset(raw.shared, 'shared'),
    dedicated: normalizePreset(raw.dedicated, 'dedicated'),
  };
}

export function resolveManagedLimaCapacityResources(capacity) {
  return capacity ? { ...capacity[capacity.mode] } : null;
}

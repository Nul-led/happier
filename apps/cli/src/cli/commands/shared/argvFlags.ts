/** Options end at --; later tokens belong to the positional arguments. */
export function findFlagIndex(argv: readonly string[], flag: string): number {
  const terminator = argv.indexOf('--');
  const index = argv.indexOf(flag);
  return index >= 0 && (terminator < 0 || index < terminator) ? index : -1;
}

export function hasFlag(argv: readonly string[], flag: string): boolean {
  return findFlagIndex(argv, flag) >= 0;
}

export function readCommandPositionals(
  argv: readonly string[],
  options: Readonly<{
    startIndex?: number;
    valueFlags?: readonly string[];
  }> = {},
): string[] {
  const positionals: string[] = [];
  const valueFlags = new Set(options.valueFlags ?? []);
  let positionalOnly = false;

  for (let index = options.startIndex ?? 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (positionalOnly) {
      positionals.push(value.trim());
      continue;
    }
    if (value === '--') {
      positionalOnly = true;
      continue;
    }
    if (value.startsWith('-')) {
      if (valueFlags.has(value) && argv[index + 1] !== '--') index += 1;
      continue;
    }
    positionals.push(value.trim());
  }

  return positionals;
}

export function readFlagValue(argv: readonly string[], flag: string): string | null {
  const idx = findFlagIndex(argv, flag);
  if (idx < 0) return null;
  const raw = argv[idx + 1];
  if (typeof raw !== 'string' || raw === '--') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readIntFlagValue(
  argv: readonly string[],
  flag: string,
  options: Readonly<{ min?: number; max?: number }> = {},
): number | null {
  if (!hasFlag(argv, flag)) return null;
  const raw = readFlagValue(argv, flag);
  const parsed = raw !== null && /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (
    !Number.isSafeInteger(parsed)
    || (options.min !== undefined && parsed < options.min)
    || (options.max !== undefined && parsed > options.max)
  ) {
    const error = new Error(`Invalid ${flag}: expected an integer within the supported range.`);
    (error as Error & { code?: string }).code = 'invalid_arguments';
    throw error;
  }
  return parsed;
}

export function readJsonFlagValue(argv: readonly string[], flag: string): unknown | null {
  const raw = readFlagValue(argv, flag);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

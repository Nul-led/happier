export type ExpoNodeHeapEnv = Record<string, string | undefined>;

export function parseExpoMaxOldSpaceSizeMb(
  env: ExpoNodeHeapEnv,
  envKey?: string,
): Readonly<{ explicit: boolean; value: number | null }>;

export function setOrReplaceMaxOldSpaceSizeFlag(
  nodeOptions: string | undefined,
  sizeMb: number,
): string;

export function applyExpoNodeHeapEnv(
  baseEnv: ExpoNodeHeapEnv,
  options?: Readonly<{ envKey?: string; defaultSizeMb?: number }>,
): Record<string, string>;

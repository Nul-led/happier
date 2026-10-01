import { z } from 'zod';
import { BoundedLegacyJsonValueSchema } from './catalog/legacyJson.js';

/** Shipped 0.2 input grammar, reused by the canonical authoring value readers. */
export const LEGACY_AUTHORING_MEMORY_SETTINGS_KEYS = Object.freeze([
  'recentMachinePaths', 'lastUsedProfile', 'lastEngineSelectionsByScopeV1',
] as const);
export type LegacyAuthoringMemorySettingsKey = typeof LEGACY_AUTHORING_MEMORY_SETTINGS_KEYS[number];

export const LegacyRecentMachinePathSchema = z.object({
  machineId: z.string().min(1).max(1024),
  path: z.string().min(1).max(16 * 1024),
}).strip();

export const LegacyRecentMachinePathsSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return [];
  const paths: Array<z.output<typeof LegacyRecentMachinePathSchema>> = [];
  for (const candidate of value) {
    const parsed = LegacyRecentMachinePathSchema.safeParse(candidate);
    if (!parsed.success) continue;
    paths.push(parsed.data);
    if (paths.length === 256) break;
  }
  return paths;
}, z.array(LegacyRecentMachinePathSchema).max(256));

export const LegacyLastUsedProfileSchema = z.string().max(1024).nullable();
export const LegacyRememberedEngineSelectionsByScopeV1Schema = z.record(
  z.string().max(64 * 1024), BoundedLegacyJsonValueSchema,
);
export type RetainedRememberedEngineSelectionsByScopeV1 = z.infer<typeof LegacyRememberedEngineSelectionsByScopeV1Schema>;

import type {
  AuthoringMemoryContentV1,
  AuthoringMemoryMutationResponseV1,
  AuthoringMemoryReadResponseV1,
  AuthoringMemoryValueV1,
} from './authoringMemory.js';
import type { LegacyAuthoringMemorySettingsKey } from './settings/legacyAuthoringMemorySettingsV1.js';

/** Absence-only transfer: a tombstone or concurrent winner is never replaced. */
export async function importAuthoringMemoryRowAbsent(options: Readonly<{
  key: string;
  value: AuthoringMemoryValueV1;
  read(key: string): Promise<AuthoringMemoryReadResponseV1>;
  mutate(key: string, expectedRevision: 'absent', content: AuthoringMemoryContentV1): Promise<AuthoringMemoryMutationResponseV1>;
  seal(key: string, value: AuthoringMemoryValueV1): AuthoringMemoryContentV1;
  assertCurrent?(): void;
}>): Promise<AuthoringMemoryReadResponseV1> {
  while (true) {
    options.assertCurrent?.();
    const row = await options.read(options.key);
    options.assertCurrent?.();
    if (row.status !== 'absent') return row;
    const content = options.seal(options.key, options.value);
    const result = await options.mutate(options.key, 'absent', content);
    options.assertCurrent?.();
    if (result.status === 'updated') return { status: 'present', revision: result.revision, content };
  }
}

/** Retire one shipped Settings key only after its destination transfer commits. */
export async function importLegacyAuthoringMemorySetting(options: Readonly<{
  key: LegacyAuthoringMemorySettingsKey;
  assertCurrent(): void;
  read(): Promise<Readonly<{ raw: Record<string, unknown> | null; version: number }>>;
  transfer(value: unknown): Promise<void>;
  remove(key: LegacyAuthoringMemorySettingsKey, expectedVersion: number): Promise<'applied' | 'conflict' | 'outcomeUnknown'>;
}>): Promise<void> {
  while (true) {
    options.assertCurrent();
    const baseline = await options.read();
    options.assertCurrent();
    if (!baseline.raw || !Object.hasOwn(baseline.raw, options.key)) return;
    await options.transfer(baseline.raw[options.key]);
    options.assertCurrent();
    const result = await options.remove(options.key, baseline.version);
    options.assertCurrent();
    if (result === 'applied') return;
    // Conflict or lost acknowledgement returns to the authoritative baseline;
    // every resumed destination transfer remains absence-only.
  }
}

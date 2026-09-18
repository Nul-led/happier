import { z } from 'zod';

export const MachineKindSchema = z.enum(['persistent', 'ephemeral_session_runner']);
export type MachineKind = z.infer<typeof MachineKindSchema>;

/** Released Machine projections and display caches predate the discriminator. */
export const MachineKindFromLegacyProjectionSchema = MachineKindSchema.default('persistent');

export function isPersistentMachine(machine: Readonly<{ kind?: MachineKind }>): boolean {
    return MachineKindFromLegacyProjectionSchema.parse(machine.kind) === 'persistent';
}

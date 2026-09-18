import type { Prisma } from '@prisma/client';

/** Ordinary inventory/selection excludes Session-bound temporary computers. Exact transport does not. */
export const persistentMachineWhere = { kind: 'persistent' } as const satisfies Prisma.MachineWhereInput;

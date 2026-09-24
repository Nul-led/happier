import { z } from 'zod';

import type { ActionSpec } from './actionSpecs.js';

/**
 * Peels the wrappers that decorate an Action input field schema without changing
 * which value it describes, reporting whether any of them admits absence or null.
 */
export function unwrapActionInputSchema(
  schema: z.ZodTypeAny,
): Readonly<{ schema: z.ZodTypeAny; optional: boolean; nullable: boolean }> {
  let current = schema;
  let optional = false;
  let nullable = false;

  for (;;) {
    if (current instanceof z.ZodOptional) {
      optional = true;
      current = current.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      optional = true;
      current = current.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodNullable) {
      nullable = true;
      current = current.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodPipe) {
      current = current.in as z.ZodTypeAny;
      continue;
    }
    break;
  }

  return { schema: current, optional, nullable };
}

/**
 * Whether the Action's own input schema declares `null` as a value of the field
 * at `path` — a stated "none" (for example `expectedItemRevision: null` requesting
 * creation), as distinct from context that is absent. A path the schema does not
 * describe structurally answers `false`.
 */
export function actionInputFieldAcceptsNull(
  spec: Pick<ActionSpec, 'inputSchema'>,
  path: string,
): boolean {
  let current: z.ZodTypeAny | undefined = spec.inputSchema as z.ZodTypeAny | undefined;
  if (!current) return false;
  for (const segment of path.split('.').map((part) => part.trim()).filter(Boolean)) {
    const inner: z.ZodTypeAny = unwrapActionInputSchema(current).schema;
    if (segment === '[]') {
      if (!(inner instanceof z.ZodArray)) return false;
      current = inner.element as z.ZodTypeAny;
      continue;
    }
    if (!(inner instanceof z.ZodObject)) return false;
    current = (inner.shape as Record<string, z.ZodTypeAny | undefined>)[segment];
    if (!current) return false;
  }
  return current.safeParse(null).success;
}

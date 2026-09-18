import { z } from 'zod';

/** Canonical connected-service credential category primitive. */
export const ConnectedServiceCredentialKindSchema = z.enum(['oauth', 'token']);
export type ConnectedServiceCredentialKind = z.infer<
  typeof ConnectedServiceCredentialKindSchema
>;

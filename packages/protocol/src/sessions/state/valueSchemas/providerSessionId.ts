import { NonBlankOpaqueIdentifierSchema } from '../../../strings/opaqueIdentifier.js';

/** The Agent's own session id: presence-validated, never renormalized. */
export const SessionStateProviderSessionIdValueSchema = NonBlankOpaqueIdentifierSchema;

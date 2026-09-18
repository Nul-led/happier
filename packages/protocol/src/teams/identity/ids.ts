import { z } from "zod";

/** Immutable Team identity-connection identifier shared by policy and connection contracts. */
export const TeamIdentityConnectionIdSchema = z.string().min(1).max(512);

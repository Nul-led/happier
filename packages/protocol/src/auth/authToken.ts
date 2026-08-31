import { z } from 'zod';

/**
 * Closed credential kinds stamped into every newly-issued signed auth token.
 * Keep this union deliberately finite: a new kind must receive an explicit
 * route-admission decision before it can authorize anything.
 */
export const AuthTokenKindSchema = z.enum([
  'account',
  'account_directory',
  'terminal',
  'api_token',
]);
export type AuthTokenKind = z.infer<typeof AuthTokenKindSchema>;

/** Server-verified authority carried by the signed token provenance marker. */
export const AuthTokenAuthoritySchema = z.enum([
  'present_user',
  'account_automation',
]);
export type AuthTokenAuthority = z.infer<typeof AuthTokenAuthoritySchema>;

/**
 * The one canonical kind→authority mapping. Every mint and every
 * verification path consumes this owner; a kind carried with any other
 * authority is not a valid credential.
 */
export const AUTH_TOKEN_KIND_AUTHORITIES: Readonly<Record<AuthTokenKind, AuthTokenAuthority>> = Object.freeze({
  account: 'present_user',
  account_directory: 'present_user',
  terminal: 'account_automation',
  api_token: 'account_automation',
});

/**
 * Top-level, signed provenance. This schema is intentionally strict so a
 * missing, future, or expanded marker cannot be silently interpreted as a
 * full Account credential, and so a kind can never travel with a
 * non-canonical authority.
 */
export const AuthTokenProvenanceSchema = z.object({
  v: z.literal(1),
  kind: AuthTokenKindSchema,
  authority: AuthTokenAuthoritySchema,
}).strict().superRefine((value, ctx) => {
  if (AUTH_TOKEN_KIND_AUTHORITIES[value.kind] !== value.authority) {
    ctx.addIssue({
      code: 'custom',
      path: ['authority'],
      message: `authority "${value.authority}" is not canonical for token kind "${value.kind}"`,
    });
  }
});
export type AuthTokenProvenance = z.infer<typeof AuthTokenProvenanceSchema>;

import { z } from 'zod';

import { DirectRouteGrantScopeV1Schema } from './directRouteGrantScopesV1.js';
import { createCanonicalJsonSigningInput } from '../../../crypto/canonicalJson.js';
import { DIRECT_ROUTE_GRANT_AUDIENCE_V1 } from './directRouteGrantV1.js';
import { PeerFlowKindV1Schema } from './flowKind.js';
import { AuthorizedPeerEndpointRouteKindV1Schema } from './routeKind.js';
import { decodeCanonicalBase64UrlFixedLength } from './strictBase64Url.js';
import { IrohEndpointIdV1Schema } from '../../../connectivity/iroh/endpointDescriptorV1.js';

export const PEER_ROUTE_EPHEMERAL_ED25519_KIND_V2 = 'ephemeral_ed25519' as const;

/**
 * Transport roles for the `happier/machine/1` relationship authorized by a V2 proof grant. The
 * role belongs to `sourceMachineId`; the target machine has the complementary role.
 */
export const IROH_PEER_ROUTE_ROLES_V2 = ['initiator', 'acceptor'] as const;
export const IrohPeerRouteRoleV2Schema = z.enum(IROH_PEER_ROUTE_ROLES_V2);

/** Machine/1 operation kinds bound to the existing grant flow and scope below. */
export const IROH_PEER_ROUTE_OPERATION_KINDS_V2 = ['file_transfer', 'attachment_transfer', 'workspace_sync'] as const;
export const IrohPeerRouteOperationKindV2Schema = z.enum(IROH_PEER_ROUTE_OPERATION_KINDS_V2);

/** Signed machine/1 endpoint-role relationship carried only by V2 `iroh_peer` grants. */
export const IrohPeerRouteBindingV2Schema = z.object({
  sourceMachineId: z.string().min(1),
  targetMachineId: z.string().min(1),
  sourceEndpointId: IrohEndpointIdV1Schema,
  targetEndpointId: IrohEndpointIdV1Schema,
  role: IrohPeerRouteRoleV2Schema,
  operationKind: IrohPeerRouteOperationKindV2Schema,
}).strict().superRefine((binding, ctx) => {
  if (binding.sourceMachineId === binding.targetMachineId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetMachineId'],
      message: 'Iroh source and target machines must be distinct',
    });
  }
  if (binding.sourceEndpointId === binding.targetEndpointId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetEndpointId'],
      message: 'Iroh source and target endpoints must be distinct',
    });
  }
});

export type IrohPeerRouteRoleV2 = z.infer<typeof IrohPeerRouteRoleV2Schema>;
export type IrohPeerRouteOperationKindV2 = z.infer<typeof IrohPeerRouteOperationKindV2Schema>;
export type IrohPeerRouteBindingV2 = z.infer<typeof IrohPeerRouteBindingV2Schema>;

type IrohPeerRouteGrantBindingFieldsV2 = Readonly<{
  machineId: string;
  flowKind: z.infer<typeof PeerFlowKindV1Schema>;
  routeKind: z.infer<typeof AuthorizedPeerEndpointRouteKindV1Schema>;
  endpointFingerprint?: string;
  iroh?: IrohPeerRouteBindingV2;
}>;

/** Canonical V2 payload/request invariant owner for the signed machine/1 relationship. */
function addIrohPeerRouteGrantBindingIssuesV2(
  payload: IrohPeerRouteGrantBindingFieldsV2,
  ctx: z.RefinementCtx,
): void {
  if (payload.routeKind === 'iroh_peer') {
    const iroh = payload.iroh;
    if (!iroh) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['iroh'],
        message: 'Iroh peer grants require the machine/1 endpoint-role binding',
      });
      return;
    }
    if (payload.machineId !== iroh.targetMachineId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['machineId'],
        message: 'Grant machineId must alias the Iroh binding target machine',
      });
    }
    if (payload.endpointFingerprint !== iroh.targetEndpointId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpointFingerprint'],
        message: 'Grant endpointFingerprint must alias the Iroh binding target endpoint',
      });
    }
    if (
      (iroh.operationKind === 'file_transfer' || iroh.operationKind === 'attachment_transfer')
      && payload.flowKind !== 'bounded_transfer'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['iroh', 'operationKind'],
        message: 'File and attachment transfers require the bounded_transfer flow',
      });
    }
    if (
      iroh.operationKind === 'workspace_sync'
      && payload.flowKind !== 'bounded_transfer'
      && payload.flowKind !== 'machine_rpc'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['iroh', 'operationKind'],
        message: 'Workspace sync requires the bounded_transfer or machine_rpc flow',
      });
    }
  } else if (payload.iroh) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['iroh'],
      message: 'The machine/1 binding is only valid on iroh_peer grants',
    });
  }
}

function fixedBase64UrlSchema(decodedLength: number): z.ZodString {
  return z.string().refine(
    (value) => decodeCanonicalBase64UrlFixedLength(value, decodedLength) !== null,
    `Expected canonical unpadded base64url encoding of ${decodedLength} bytes`,
  );
}

export const DirectRouteGrantPayloadV2Schema = z
  .object({
    v: z.literal(2),
    grantId: z.string().min(1),
    grantFamilyId: z.string().min(1).optional(),
    accountId: z.string().min(1),
    machineId: z.string().min(1),
    flowKind: PeerFlowKindV1Schema,
    routeKind: AuthorizedPeerEndpointRouteKindV1Schema,
    scope: DirectRouteGrantScopeV1Schema,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    aud: z.literal(DIRECT_ROUTE_GRANT_AUDIENCE_V1),
    endpointFingerprint: z.string().min(1).optional(),
    iroh: IrohPeerRouteBindingV2Schema.optional(),
    proofKind: z.literal(PEER_ROUTE_EPHEMERAL_ED25519_KIND_V2),
    ephemeralPublicKeyBase64Url: fixedBase64UrlSchema(32),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.scope.kind !== payload.flowKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope', 'kind'],
        message: 'Grant scope kind must match flow kind',
      });
    }
    if (payload.exp <= payload.iat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exp'],
        message: 'Grant expiry must be after issue time',
      });
    }
    addIrohPeerRouteGrantBindingIssuesV2(payload, ctx);
  });

export const DirectRouteGrantSignatureV2Schema = z
  .object({
    keyId: z.string().min(1),
    alg: z.literal('Ed25519'),
    valueBase64Url: fixedBase64UrlSchema(64),
  })
  .strict();

export const SignedDirectRouteGrantV2Schema = z
  .object({
    payload: DirectRouteGrantPayloadV2Schema,
    signature: DirectRouteGrantSignatureV2Schema,
  })
  .strict();

export const DirectRouteGrantRequestV2Schema = z
  .object({
    v: z.literal(2),
    kind: z.literal(PEER_ROUTE_EPHEMERAL_ED25519_KIND_V2),
    ephemeralPublicKeyBase64Url: fixedBase64UrlSchema(32),
    machineId: z.string().min(1),
    flowKind: PeerFlowKindV1Schema,
    routeKind: AuthorizedPeerEndpointRouteKindV1Schema,
    endpointFingerprint: z.string().min(1),
    ttlMs: z.number().int().positive(),
    scope: DirectRouteGrantScopeV1Schema,
    iroh: IrohPeerRouteBindingV2Schema.optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.scope.kind !== request.flowKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope', 'kind'],
        message: 'Grant request scope kind must match flow kind',
      });
    }
    addIrohPeerRouteGrantBindingIssuesV2(request, ctx);
  });

export type DirectRouteGrantPayloadV2 = z.infer<typeof DirectRouteGrantPayloadV2Schema>;
export type DirectRouteGrantSignatureV2 = z.infer<typeof DirectRouteGrantSignatureV2Schema>;
export type SignedDirectRouteGrantV2 = z.infer<typeof SignedDirectRouteGrantV2Schema>;
export type DirectRouteGrantRequestV2 = z.infer<typeof DirectRouteGrantRequestV2Schema>;

export function createDirectRouteGrantSigningInputV2(payload: DirectRouteGrantPayloadV2): string {
  return createCanonicalJsonSigningInput(DirectRouteGrantPayloadV2Schema.parse(payload));
}

export function createSignedDirectRouteGrantDigestInputV2(grant: SignedDirectRouteGrantV2): Uint8Array {
  const parsed = SignedDirectRouteGrantV2Schema.parse(grant);
  return new TextEncoder().encode(createCanonicalJsonSigningInput(parsed));
}

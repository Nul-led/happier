import { z } from 'zod';

import { IrohEndpointIdV1Schema } from '../connectivity/iroh/endpointDescriptorV1.js';

export const MachineOperationProtocolVersionsV1Schema = z
  .tuple([z.literal(1)])
  .readonly();

export const MachineOperationProtocolCapabilityV1Schema = z
  .object({
    protocolVersions: MachineOperationProtocolVersionsV1Schema,
  })
  .strict()
  .readonly();

/**
 * Current transport identity published by the authenticated daemon through the
 * existing complete Machine projection. The projection's server-assigned
 * revision supplies currentness; this leaf supplies only the endpoint identity.
 */
export const MachineIrohEndpointCapabilityV1Schema = z
  .object({
    protocolVersions: MachineOperationProtocolVersionsV1Schema,
    endpointId: IrohEndpointIdV1Schema,
  })
  .strict()
  .readonly();

export const MachineOperationProtocolCapabilitiesV1Schema = z
  .object({
    sessionInputAdmission: MachineOperationProtocolCapabilityV1Schema.optional(),
    sessionSpawn: MachineOperationProtocolCapabilityV1Schema.optional(),
    pluginWebhookClaim: MachineOperationProtocolCapabilityV1Schema.optional(),
    irohMachineEndpoint: MachineIrohEndpointCapabilityV1Schema.optional(),
  })
  .strict()
  .readonly();

export type MachineOperationProtocolCapabilityV1 = z.infer<
  typeof MachineOperationProtocolCapabilityV1Schema
>;
export type MachineOperationProtocolCapabilitiesV1 = z.infer<
  typeof MachineOperationProtocolCapabilitiesV1Schema
>;
export type MachineOperationProtocolCapabilityNameV1 = keyof MachineOperationProtocolCapabilitiesV1;
export type MachineIrohEndpointAuthorityV1 = Readonly<{
  endpointId: string;
  revision: number;
}>;

/** Fail-closed reader for the endpoint identity plus its accepted projection revision. */
export function readMachineIrohEndpointAuthorityV1(input: Readonly<{
  capabilities: unknown;
  revision: unknown;
}>): MachineIrohEndpointAuthorityV1 | null {
  const capabilities = MachineOperationProtocolCapabilitiesV1Schema.safeParse(input.capabilities);
  if (
    !capabilities.success
    || !Number.isInteger(input.revision)
    || (input.revision as number) < 1
    || !capabilities.data.irohMachineEndpoint
  ) return null;
  return {
    endpointId: capabilities.data.irohMachineEndpoint.endpointId,
    revision: input.revision as number,
  };
}

/**
 * This is intentionally a narrow Machine mutation rather than a generic
 * capability registry. The authenticated socket identity remains authoritative
 * when the optional payload id is absent or disagrees.
 */
export const MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1 =
  'machine-update-operation-protocol-capabilities';

const MachineOperationProtocolCapabilityMachineIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256);

/**
 * A daemon always sends its complete current projection. Persisted projections
 * replace rather than merge, so omitting a leaf explicitly withdraws it.
 */
export const MachineUpdateOperationProtocolCapabilitiesRequestV1Schema = z
  .object({
    machineId: MachineOperationProtocolCapabilityMachineIdSchema.optional(),
    capabilities: MachineOperationProtocolCapabilitiesV1Schema,
  })
  .strict()
  .readonly();

export type MachineUpdateOperationProtocolCapabilitiesRequestV1 = z.infer<
  typeof MachineUpdateOperationProtocolCapabilitiesRequestV1Schema
>;

export const MachineUpdateOperationProtocolCapabilitiesResponseV1Schema = z
  .discriminatedUnion('result', [
    z.object({
      v: z.literal(1),
      result: z.literal('success'),
      revision: z.number().int().positive(),
    }).strict(),
    z.object({
      v: z.literal(1),
      result: z.literal('error'),
      code: z.enum(['invalid_request', 'machine_unavailable', 'internal_error']),
    }).strict(),
  ])
  .readonly();

export type MachineUpdateOperationProtocolCapabilitiesResponseV1 = z.infer<
  typeof MachineUpdateOperationProtocolCapabilitiesResponseV1Schema
>;

/**
 * Capability absence or malformed persisted data is incompatible. This is the
 * sole predicate for exact Machine-operation protocol leaves; callers must not
 * infer support from daemon version, liveness, or encrypted daemon state.
 */
export function supportsMachineOperationProtocolCapabilityV1(
  capabilities: unknown,
  capability: MachineOperationProtocolCapabilityNameV1,
): boolean {
  const parsed = MachineOperationProtocolCapabilitiesV1Schema.safeParse(capabilities);
  return parsed.success && parsed.data[capability]?.protocolVersions[0] === 1;
}

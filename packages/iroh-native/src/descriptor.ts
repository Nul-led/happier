import {
  parseIrohEndpointDescriptorV1,
  type IrohEndpointDescriptorV1,
} from '@happier-dev/protocol';

export const HOME_TUNNEL_ALPN = 'happier/home-tunnel/1' as const;
export const MACHINE_ALPN = 'happier/machine/1' as const;
export const TUNNEL_PREAMBLE = 0x01 as const;

/**
 * The Iroh endpoint descriptor has exactly one wire definition: the protocol
 * package's connectivity module. This file is a native-side adapter over it —
 * never a second shape or a permissive parser.
 */
export type { IrohEndpointDescriptorV1 };

export function parseIrohEndpointDescriptor(value: unknown): IrohEndpointDescriptorV1 {
  return parseIrohEndpointDescriptorV1(value);
}

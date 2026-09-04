import {
  parseIrohEndpointDescriptorV1,
  type IrohEndpointDescriptorV1,
} from '@happier-dev/protocol';

export const HOME_TUNNEL_ALPN = 'happier/home-tunnel/1' as const;
export const MACHINE_ALPN = 'happier/machine/1' as const;
export const TUNNEL_PREAMBLE = 0x01 as const;
export const MAX_MACHINE_HANDSHAKE_BYTES = 64 * 1024;
export const MACHINE_CONTROL_TIMEOUT_MS = 10_000;
export const MACHINE_ADMISSION_PATH = '/v1/iroh/machine/admit' as const;
export const MACHINE_REMOTE_ENDPOINT_HEADER = 'X-Happier-Iroh-Remote-Endpoint-Id' as const;
export const MACHINE_APPLICATION_PORT_HEADER = 'X-Happier-Iroh-Application-Port' as const;
export const MACHINE_APPLICATION_CAPABILITY_HEADER = 'X-Happier-Iroh-Application-Capability' as const;
export const MACHINE_HTTP_LOCAL_CAPABILITY_HEADER = 'x-happier-machine-local-capability' as const;
export const MACHINE_STREAM_ACCEPT_BYTE = 0x01 as const;
export const MACHINE_STREAM_REJECT_BYTE = 0x00 as const;

/**
 * The Iroh endpoint descriptor has exactly one wire definition: the protocol
 * package's connectivity module. This file is a native-side adapter over it —
 * never a second shape or a permissive parser.
 */
export type { IrohEndpointDescriptorV1 };

export function parseIrohEndpointDescriptor(value: unknown): IrohEndpointDescriptorV1 {
  return parseIrohEndpointDescriptorV1(value);
}

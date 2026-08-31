import type { FastifyInstance } from 'fastify';
import {
  IrohEndpointIdV1Schema,
  IrohMachineHandshakeV1Schema,
  type IrohMachineCarrierFlowV1,
  type IrohMachineHandshakeV1,
  type IrohMachineHandshakeRoleV1,
} from '@happier-dev/protocol';
import {
  IROH_MACHINE_ADMISSION_PATH,
  IROH_MACHINE_APPLICATION_PORT_HEADER,
  IROH_MACHINE_REMOTE_ENDPOINT_HEADER,
} from '@happier-dev/iroh-native/node';

import { verifyMachineCarrierHandshakeV1 } from '../../iroh/machineCarrier';
import type { DirectRouteGrantTrustRoot } from '../verifyDirectRouteGrantV1';

/**
 * Explicit machine-Iroh admission configuration for the peer-mediation loopback app
 * (lane-06 I9). The admission route exists only while this config is supplied; the
 * native `happier/machine/1` acceptor POSTs the canonical handshake JSON to the fixed
 * admission path with the authenticated remote EndpointId header and admits a stream
 * only on a 2xx response echoing that exact header.
 */
export type PeerMediationLoopbackIrohMachineAdmissionOptions = Readonly<{
  /** Local Iroh endpoint identity bound into every admitted handshake. */
  localEndpointId: string;
  /** Local role of this side (`initiator` dials, `acceptor` listens). */
  role: IrohMachineHandshakeRoleV1;
  /** Precise admitted carrier flows; a handshake flow outside this list fails closed. */
  allowedFlows: readonly IrohMachineCarrierFlowV1[];
  /**
   * Selects the existing local application owner for this already-verified
   * stream. The peer never supplies a destination: native Rust accepts only
   * this trusted response port and always connects to 127.0.0.1.
   */
  resolveApplicationPort: (input: Readonly<{
    handshake: IrohMachineHandshakeV1;
    authenticatedRemoteEndpointId: string;
  }>) => number | null | Promise<number | null>;
}>;

export type RegisterPeerMediationIrohMachineAdmissionRouteOptions = Readonly<{
  admission: PeerMediationLoopbackIrohMachineAdmissionOptions;
  accountId: string;
  machineId: string;
  trustRoots: readonly DirectRouteGrantTrustRoot[];
  nowMs: () => number;
}>;

/**
 * One stable rejection for every admission failure (missing/duplicate/malformed
 * header, malformed body, grant/proof/expiry/account/machine/endpoint/role/flow
 * mismatch): no reason codes, no secret detail, and no endpoint echo the native
 * acceptor could mistake for admission.
 */
const IROH_MACHINE_ADMISSION_REJECT_STATUS = 403;

export function registerPeerMediationIrohMachineAdmissionRoute(
  app: FastifyInstance,
  options: RegisterPeerMediationIrohMachineAdmissionRouteOptions,
): void {
  const remoteEndpointHeaderName = IROH_MACHINE_REMOTE_ENDPOINT_HEADER.toLowerCase();
  app.post(IROH_MACHINE_ADMISSION_PATH, async (request, reply) => {
    // The Iroh transport supplies exactly one authenticated remote EndpointId. Node folds
    // duplicate header lines into one comma-separated value, which the strict endpoint
    // grammar (single 32-byte identity) rejects together with empty/malformed values.
    const headerValue = request.headers[remoteEndpointHeaderName];
    const headerValues = Array.isArray(headerValue) ? headerValue : [headerValue];
    const authenticatedRemoteEndpointId = headerValues.length === 1
      && typeof headerValues[0] === 'string'
      && IrohEndpointIdV1Schema.safeParse(headerValues[0]).success
      ? headerValues[0]
      : undefined;
    if (authenticatedRemoteEndpointId === undefined) {
      return reply.code(IROH_MACHINE_ADMISSION_REJECT_STATUS).send();
    }

    // The canonical handshake schema is the single wire definition; parsing it here gates
    // the admitted operation flow. The pure verifier below re-validates the same body
    // through that one schema, so there is no second handshake parser or grant verifier.
    const parsedHandshake = IrohMachineHandshakeV1Schema.safeParse(request.body);
    if (!parsedHandshake.success || !options.admission.allowedFlows.includes(parsedHandshake.data.flow)) {
      return reply.code(IROH_MACHINE_ADMISSION_REJECT_STATUS).send();
    }

    try {
      const verified = verifyMachineCarrierHandshakeV1({
        handshake: request.body,
        accountId: options.accountId,
        machineId: options.machineId,
        localEndpointId: options.admission.localEndpointId,
        role: options.admission.role,
        trustRoots: options.trustRoots,
        nowMs: options.nowMs(),
        authenticatedRemoteEndpointId,
      });
      const applicationPort = await options.admission.resolveApplicationPort({
        handshake: verified.handshake,
        authenticatedRemoteEndpointId: verified.remoteEndpointId,
      });
      if (
        typeof applicationPort !== 'number'
        || !Number.isInteger(applicationPort)
        || applicationPort < 1
        || applicationPort > 65_535
      ) {
        return reply.code(IROH_MACHINE_ADMISSION_REJECT_STATUS).send();
      }
      // Bodyless 204 with both values required by the native acceptor: the
      // authenticated endpoint echo and the trusted, stream-specific local port.
      return reply
        .code(204)
        .header(IROH_MACHINE_REMOTE_ENDPOINT_HEADER, verified.remoteEndpointId)
        .header(IROH_MACHINE_APPLICATION_PORT_HEADER, String(applicationPort))
        .send();
    } catch {
      return reply.code(IROH_MACHINE_ADMISSION_REJECT_STATUS).send();
    }
  });
}

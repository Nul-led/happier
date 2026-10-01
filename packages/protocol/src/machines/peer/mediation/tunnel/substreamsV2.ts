import { z } from 'zod';

export const PeerTcpTunnelSubstreamCapsV2Schema = z.object({
  maxConcurrentSubstreams: z.number().int().positive(),
  maxTotalSubstreams: z.number().int().positive().optional(),
  maxBytesPerSubstream: z.number().int().positive().optional(),
  maxAggregateBytes: z.number().int().positive().optional(),
  maxSubstreamIdleMs: z.number().int().positive().optional(),
  maxSessionIdleMs: z.number().int().positive().optional(),
});
export type PeerTcpTunnelSubstreamCapsV2 = z.infer<typeof PeerTcpTunnelSubstreamCapsV2Schema>;

import { z } from 'zod';

export const SessionHandoffStorageModeSchema = z.enum(['direct', 'persisted']);
export type SessionHandoffStorageMode = z.infer<typeof SessionHandoffStorageModeSchema>;

export const SessionHandoffTransportStrategySchema = z.enum(['direct_peer', 'server_routed_stream']);
export type SessionHandoffTransportStrategy = z.infer<typeof SessionHandoffTransportStrategySchema>;

export const SessionHandoffRecoveryActionSchema = z.enum(['restart_on_source', 'keep_stopped']);
export type SessionHandoffRecoveryAction = z.infer<typeof SessionHandoffRecoveryActionSchema>;

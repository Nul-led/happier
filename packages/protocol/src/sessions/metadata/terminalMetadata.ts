import { z } from 'zod';
import { WINDOWS_REMOTE_SESSION_LAUNCH_MODES } from './windowsRemoteSessionLaunchMode.js';

/**
 * Session terminal attachment metadata (stored in encrypted `session.metadata`).
 *
 * Keep schemas permissive (passthrough) for forward compatibility.
 * Use factory forms for nohoist/multi-Zod repos.
 */

export function createSessionTerminalControlServiceabilityV1Schema(zod: typeof z) {
  return zod.object({
    v: zod.literal(1),
    attachmentId: zod.string().optional(),
    state: zod.enum(['servable', 'recoverable_unservable', 'unknown']),
    observedAt: zod.number(),
    reason: zod.string().optional(),
    retired: zod.boolean().optional(),
  }).passthrough();
}

export const SessionTerminalControlServiceabilityV1Schema = createSessionTerminalControlServiceabilityV1Schema(z);

export function createSessionTerminalMetadataSchema(zod: typeof z) {
  const terminalModeSchema = zod.enum(['plain', 'tmux', 'zellij', 'windows_terminal', 'windows_console']);
  const requestedModeSchema = zod.enum(['plain', 'tmux', 'zellij', ...WINDOWS_REMOTE_SESSION_LAUNCH_MODES]);
  return zod
    .object({
      mode: terminalModeSchema.optional(),
      requested: requestedModeSchema.optional(),
      fallbackReason: zod.string().optional(),
      controlServiceabilityV1: createSessionTerminalControlServiceabilityV1Schema(zod).optional(),
      tmux: zod
        .object({
          target: zod.string(),
          tmpDir: zod.string().nullable().optional(),
        })
        .optional(),
      windows: zod
        .object({
          host: zod.enum(['windows_terminal', 'console']),
          windowId: zod.string().optional(),
          pid: zod.number().int().optional(),
          title: zod.string().optional(),
        })
        .optional(),
    })
    .passthrough()
    .superRefine((value, ctx) => {
      if (value.mode === undefined && value.controlServiceabilityV1?.retired !== true) {
        ctx.addIssue({
          code: zod.ZodIssueCode.custom,
          path: ['mode'],
          message: 'Mode-less terminal metadata is accepted only for an explicitly retired legacy attachment',
        });
      }
    });
}

export const SessionTerminalMetadataSchema = createSessionTerminalMetadataSchema(z);
export type SessionTerminalMetadata = z.infer<typeof SessionTerminalMetadataSchema>;

/**
 * The one reader for the terminal control-serviceability state held in owner metadata. Hosts hold
 * this evidence in different views (decoded owner metadata, the renderable list projection, the
 * CLI's decrypted row), so the shape is parsed here rather than per host: a malformed or
 * foreign-version envelope is `null` (no evidence), never a fabricated state.
 */
export function readSessionTerminalControlServiceabilityStateV1(
  value: unknown,
): 'servable' | 'recoverable_unservable' | 'unknown' | null {
  const parsed = SessionTerminalControlServiceabilityV1Schema.safeParse(value);
  return parsed.success ? parsed.data.state : null;
}

export function isSessionTerminalPermanentlyAbsent(
  value: SessionTerminalMetadata['controlServiceabilityV1'] | null | undefined,
): boolean {
  return value?.v === 1 && value.retired === true;
}

/** The daemon's maximum wait for a newly spawned Session webhook. */
export const DEFAULT_SESSION_WEBHOOK_TIMEOUT_MS = 5 * 60_000;

/** The Message admission phase after Session identity has been established. */
export const DEFAULT_SPAWN_INITIAL_INPUT_ADMISSION_TIMEOUT_MS = 60_000;

/** Work that can occur inside one session.spawn_new Action before it settles. */
export const DEFAULT_SESSION_SPAWN_OPERATION_TIMEOUT_MS =
  DEFAULT_SESSION_WEBHOOK_TIMEOUT_MS + DEFAULT_SPAWN_INITIAL_INPUT_ADMISSION_TIMEOUT_MS;

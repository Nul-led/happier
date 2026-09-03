/**
 * The one owner of the Run-scoped reply-handoff identity.
 *
 * A Conversation Run's reply handoff is deterministic so that a lost admission
 * response rejoins the same frozen handoff instead of creating a second one.
 * Channels derives its outward custody identity from that handoff id, so the id
 * is also the answer to "is this the same delivery?": reusing it rejoins the
 * exact custody row and produces no second external effect.
 *
 * A present user who consciously asks for another delivery after an ambiguous
 * outcome therefore needs a *different* identity, and the ordinal suffix is it.
 * It stays derivable from the Run and the current id, so no counter column,
 * ledger, or random identity is introduced — and every reader that must decide
 * "does this handoff belong to this Run?" (admission equality on the server,
 * sealed result correspondence on the daemon) keeps one exact answer instead of
 * comparing against a single frozen string it can no longer recognize.
 */

const AUTOMATION_REPLY_HANDOFF_ID_PREFIX = 'automation-reply-handoff:';
const AUTOMATION_REPLY_HANDOFF_ORDINAL_SEPARATOR = '#';
/**
 * A user can only add one delivery per explicit exact-revision authorization,
 * so this ceiling is unreachable in practice. It exists so the derived id can
 * never grow without bound or overflow the persisted column.
 */
const MAX_AUTOMATION_REPLY_HANDOFF_ORDINAL_V1 = 1_000;

/** The first identity, frozen when Conversation admission creates the Run. */
export function automationReplyHandoffIdForRunV1(runId: string): string {
  return `${AUTOMATION_REPLY_HANDOFF_ID_PREFIX}${runId}`;
}

function readAutomationReplyHandoffOrdinal(input: Readonly<{
  runId: string;
  handoffId: string;
}>): number | null {
  const base = automationReplyHandoffIdForRunV1(input.runId);
  if (input.handoffId === base) return 1;
  if (!input.handoffId.startsWith(`${base}${AUTOMATION_REPLY_HANDOFF_ORDINAL_SEPARATOR}`)) {
    return null;
  }
  const ordinal = input.handoffId.slice(
    base.length + AUTOMATION_REPLY_HANDOFF_ORDINAL_SEPARATOR.length,
  );
  // Only the exact canonical spelling is this Run's identity: a padded, signed,
  // or non-numeric suffix is another string, not another delivery.
  if (!/^[1-9][0-9]*$/u.test(ordinal)) return null;
  const parsed = Number(ordinal);
  return Number.isSafeInteger(parsed)
    && parsed >= 2
    && parsed <= MAX_AUTOMATION_REPLY_HANDOFF_ORDINAL_V1
    ? parsed
    : null;
}

/** Whether a handoff id is one of this exact Run's own delivery identities. */
export function isAutomationReplyHandoffIdForRunV1(input: Readonly<{
  runId: string;
  handoffId: string | null | undefined;
}>): boolean {
  return typeof input.handoffId === 'string'
    && readAutomationReplyHandoffOrdinal({
      runId: input.runId,
      handoffId: input.handoffId,
    }) !== null;
}

/**
 * The next distinct delivery identity for this Run, or `null` when the current
 * id is not this Run's own identity or the ceiling has been reached. The caller
 * must still fence the write on the exact Run revision, so a replayed
 * authorization derives the same next id and loses its compare-and-swap instead
 * of minting a second delivery.
 */
export function nextAutomationReplyHandoffIdForRunV1(input: Readonly<{
  runId: string;
  handoffId: string | null | undefined;
}>): string | null {
  if (typeof input.handoffId !== 'string') return null;
  const ordinal = readAutomationReplyHandoffOrdinal({
    runId: input.runId,
    handoffId: input.handoffId,
  });
  if (ordinal === null || ordinal >= MAX_AUTOMATION_REPLY_HANDOFF_ORDINAL_V1) return null;
  return [
    automationReplyHandoffIdForRunV1(input.runId),
    AUTOMATION_REPLY_HANDOFF_ORDINAL_SEPARATOR,
    ordinal + 1,
  ].join('');
}

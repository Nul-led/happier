/**
 * The one cross-field owner of the resume-only External Sessions source
 * contract.
 *
 * A source that declares `resumeOnly` promises discovery of provider sessions
 * for the resume-in-Happier flow. That promise is only fulfillable when the
 * same Agent contribution is an ACP, Session-primary Agent whose Session
 * capabilities explicitly open `resume`; otherwise the host's declarative
 * ACP session-listing synthesis would advertise candidates no runtime can
 * load. The Agent contribution schema refines with this exact predicate, and
 * the SDK authoring assertion plus the host's defensive runtime synthesis
 * consume it, so the rule has one semantic owner.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const AGENT_RESUME_ONLY_SOURCE_CONTRACT_ISSUE =
  'A resume-only External Sessions source requires an ACP Session-primary Agent whose Session capabilities explicitly open "resume".';

/**
 * Returns `null` when the contribution carries no resume-only source or its
 * ACP Session-primary declaration explicitly opens `resume`; otherwise the
 * contract issue every enforcement boundary reports.
 */
export function findAgentResumeOnlyExternalSourceContractIssue(
  contribution: unknown,
): string | null {
  if (!isRecord(contribution)) return null;
  const surfaces = isRecord(contribution.surfaces) ? contribution.surfaces : undefined;
  const externalSession = isRecord(surfaces?.externalSession) ? surfaces.externalSession : undefined;
  const sources = Array.isArray(externalSession?.sources) ? externalSession.sources : [];
  const declaresResumeOnlySource = sources.some(
    (source) => isRecord(source) && source.resumeOnly === true,
  );
  if (!declaresResumeOnlySource) return null;

  const runtime = isRecord(contribution.runtime) ? contribution.runtime : undefined;
  const capabilities = isRecord(contribution.capabilities) ? contribution.capabilities : undefined;
  const sessions = isRecord(capabilities?.sessions) ? capabilities.sessions : undefined;
  const open = Array.isArray(sessions?.open) ? sessions.open : [];
  const fulfillsResume = runtime?.kind === 'acp'
    && contribution.primary === 'sessions'
    && open.includes('resume');
  return fulfillsResume ? null : AGENT_RESUME_ONLY_SOURCE_CONTRACT_ISSUE;
}

/**
 * Returns `true` when EVERY declared External Sessions source of a valid
 * resume-only ACP Agent contribution is `resumeOnly`, which is exactly the
 * declaration the host itself produces a session-listing contribution for.
 *
 * Such a contribution owes no plugin-authored External Sessions runtime: the
 * declarative ACP runtime registry synthesizes the single generic
 * `session/list` producer, and a plugin-authored one would be a second owner.
 * A mixed source set still carries at least one source the host cannot serve,
 * so it keeps owing the plugin contribution and fails closed without it.
 *
 * This is the one owner of that rule: the SDK authoring assertion, the
 * registration rights the host activation enforces, and the host's runtime
 * synthesis all read it here rather than restating the traversal.
 */
export function declaresHostSynthesizedAgentResumeOnlyExternalSources(
  contribution: unknown,
): boolean {
  if (!isRecord(contribution)) return false;
  const surfaces = isRecord(contribution.surfaces) ? contribution.surfaces : undefined;
  const externalSession = isRecord(surfaces?.externalSession) ? surfaces.externalSession : undefined;
  const sources = Array.isArray(externalSession?.sources) ? externalSession.sources : [];
  return sources.length > 0
    && sources.every((source) => isRecord(source) && source.resumeOnly === true)
    && findAgentResumeOnlyExternalSourceContractIssue(contribution) === null;
}

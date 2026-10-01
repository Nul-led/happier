/** A Team-shared source cannot opt out; several grants require an explicit choice. */
export function resolveWorkflowRunVisibleTeamV1(
  grantedTeamIds: readonly string[],
  visibleTeamId?: string | null,
): Readonly<{ ok: true; visibleTeamId: string | null }> | Readonly<{ ok: false; code: 'visible_team_not_granted' }> {
  if (visibleTeamId === undefined) {
    return grantedTeamIds.length > 1
      ? { ok: false, code: 'visible_team_not_granted' }
      : { ok: true, visibleTeamId: grantedTeamIds[0] ?? null };
  }
  if (visibleTeamId === null ? grantedTeamIds.length !== 0 : !grantedTeamIds.includes(visibleTeamId)) {
    return { ok: false, code: 'visible_team_not_granted' };
  }
  return { ok: true, visibleTeamId };
}

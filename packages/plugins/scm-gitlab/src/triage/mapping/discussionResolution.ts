/**
 * Whether one GitLab discussion is resolved, read from the only place GitLab
 * publishes it.
 *
 * The discussions API answers `{ id, individual_note, notes: [...] }` and carries
 * `resolvable`/`resolved` on each NOTE; the discussion object itself has neither
 * field. One reader serves both callers who must agree — the mounted thread
 * projection the reader presses, and the resolution mutation's preflight and
 * confirming read — because a mutation that decided resolvability by a different
 * rule than the surface would refuse a thread that visibly offers the control.
 *
 * A thread is resolvable when GitLab marks any of its notes resolvable, and it is
 * resolved when every resolvable note is: that is GitLab's own model, where
 * resolving a thread resolves its resolvable notes together. A system note or an
 * unresolvable reply beside them therefore never makes a resolved thread look
 * open.
 */

export type GitlabDiscussionResolutionV1 = Readonly<{
  resolvable: boolean;
  resolved: boolean;
}>;

const UNRESOLVABLE: GitlabDiscussionResolutionV1 = Object.freeze({
  resolvable: false,
  resolved: false,
});

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export function readGitlabDiscussionResolution(
  notes: unknown,
): GitlabDiscussionResolutionV1 {
  if (!Array.isArray(notes)) return UNRESOLVABLE;
  let resolvable = false;
  let allResolved = true;
  for (const candidate of notes) {
    const note = readRecord(candidate);
    if (note === null || note.resolvable !== true) continue;
    resolvable = true;
    if (note.resolved !== true) allResolved = false;
  }
  return resolvable
    ? Object.freeze({ resolvable: true, resolved: allResolved })
    : UNRESOLVABLE;
}

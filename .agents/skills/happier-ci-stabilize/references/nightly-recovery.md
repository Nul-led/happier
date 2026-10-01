# Nightly recovery and work preservation

## Choose the cheapest safe recovery

| Evidence | Recovery | Why |
|---|---|---|
| Same workflow SHA; transient runner, download, read-only API, or external failure; failed job is safe to retry | Native failed-job rerun | Retains successful jobs and retries only failures/dependents |
| New workflow-control/test/validation fix; origin run is terminal; immutable candidates were individually verified; candidate/source bytes are unchanged | Dispatch nightly with `resume_run_id=<origin-run-id>` from corrected control | Reuses builds/signing while re-verifying identity and rerunning downstream gates |
| Product source, packaging inputs, build scripts, dependencies, signing inputs, or candidate bytes changed | Fresh nightly | Old artifacts no longer prove the new source |
| Ambiguous mutation failure | Reconcile observed remote state, then use the owning recovery-aware rerun | Blind retry could duplicate publication |
| Origin run is active or lacks its terminal status artifact | Wait | Resume trust requires completed evidence |

The current public nightly input is defined by `.github/workflows/nightly-dev.yml`. First check for an active scheduled or manual run already serving the same recovery; do not queue duplicate publication work. Bind the intended release line and channel explicitly: this development checkout does not authorize replacing the released 0.2 channel. A typical authorized dispatch with existing source CI is:

```bash
yarn ghops workflow run nightly-dev.yml \
  --repo happier-dev/happier \
  --ref dev \
  -f source_ref=<candidate-source-sha> \
  -f ci_run_id=<successful-candidate-source-ci-run-id> \
  -f resume_run_id=<completed-origin-run-id>
```

Do not dispatch merely because this command is documented. Follow `.agents/skills/happier-release`, confirm current authority, exact control SHA, origin run, and source identity first. GitHub mutations use the isolated `happier-bot` transport; never substitute a personal `gh` login when `ghops` authentication is unavailable. If the private release conductor owns the requested operation, use that conductor instead of dispatching the public workflow directly.

## Resume invariants

On resume, the resolver binds the preserved candidate source SHA from the origin, while `--ref` selects workflow control bytes. The supplied `ci_run_id` must prove that candidate source, not a newer control-only fix. CI for the newer control change is separate evidence. Verify both identities and skipped build/sign jobs before claiming reuse.

The resolver must prove the origin workflow/channel, terminal `happier-release-status` artifact, candidate source SHA, candidate version, and individual verification evidence. A resumed run still performs actor/source trust gates and exact artifact verification. Skipped build/sign jobs are expected reuse evidence.

A control-only fix may reuse candidates only when trusted current control bytes are separated from preserved candidate source. Never execute a new control flag using an old candidate checkout that cannot support it.

Desktop recovery reuses unexpired `tauri-candidate-dev-*` artifacts from that same original candidate-producing nightly. The resolver admits exact artifact IDs and SHA-256 digests; each finalizer verifies the archive digest before the existing source/channel/version/platform and file-hash checks. Missing or expired platforms alone rebuild. All available candidates skip unsigned builds, but trusted current-control finalizers still run. Desktop versions retain the original run number.

Keep using that original run ID for later control-fixed retries. A resumed run records its desktop origin in the existing status identity and cannot itself become a desktop resume origin. This does not merge artifacts across runs: a later new-control retry can rebuild platforms that were missing in the original run; a same-control native failed-job rerun retains successful new sibling builds. Legacy original runs without this identity field remain admissible, subject to the existing manifest checks. Docker and mobile reuse are not provided by this desktop path.

### Desktop-only public dev recovery

When the other published surfaces already match the admitted candidate and only desktop needs publication recovery, an explicitly authorized **public dev** operation may dispatch the existing `build-tauri.yml` instead of repeating the whole nightly. This is not a preview/stable or private-conductor bypass. A product/runtime defect, changed source, or invalid candidate requires a fresh candidate, even if finalization previously succeeded.

Before dispatch, bind the intended repository/release line, the reviewed control SHA currently at `dev`, and the exact original candidate source SHA. Select the terminal **original candidate-producing nightly** as `DESKTOP_ORIGIN_RUN_ID`, not a resumed nightly or a standalone desktop run. Check its admitted artifacts, original desktop version/run number, and exact `release_message`. Confirm no scheduled nightly, manual recovery, or other operation has active or pending desktop publication for this channel. An unrelated side lane may still be running once that run's desktop publication branch is terminal; separate workflow concurrency groups do not establish publisher exclusion.

With `CANDIDATE_SOURCE_SHA` bound to that source and `CANDIDATE_RELEASE_MESSAGE_FILE` containing the original approved message unchanged, the supported dispatch shape is:

```bash
yarn ghops workflow run build-tauri.yml \
  --repo happier-dev/happier \
  --ref dev \
  -f environment=dev \
  -f source_ref="$CANDIDATE_SOURCE_SHA" \
  -f publish_release=true \
  -f resume_run_id="$DESKTOP_ORIGIN_RUN_ID" \
  -F release_message=@"$CANDIDATE_RELEASE_MESSAGE_FILE"
```

Use the authorized bot transport; the example grants no dispatch permission. `--ref dev` selects control, not candidate source: bind the created run ID and verify its `headSha` equals the reviewed control SHA. The resolver supplies the original `desktop_run_number`; verify the resolved build version is unchanged rather than using the recovery run number or `retry_version`. Admitted platforms skip unsigned builds, but every finalizer still runs before desktop publication.

Close only after terminal desktop publication and verification of the desktop release/updater assets and `ui-desktop-dev` source identity. Skipped builds or green finalizers alone are not publication proof. Separately inspect the parent nightly's **Verify promoted nightly references** job and `happier-release-status`: standalone success does not turn the parent green or repair a mobile/TestFlight failure. If that verifier failed only because desktop references were missing and its other prerequisites remain valid, an authorized job-scoped retry may use its `databaseId` from `yarn ghops run view <parent-run-id> --json jobs` with `yarn ghops run rerun <parent-run-id> --job <job-database-id>`; inspect the resulting attempt/status rather than assuming it repairs the parent. Avoid a broad failed-job rerun that repeats unrelated publication work.

## Monitoring

- Use step-level status to distinguish queueing, installation, compilation, notarization, store processing, publication, and cleanup.
- Poll long operations every 5-20 minutes; avoid repeated 30-second reads.
- A GitHub API timeout while polling is not a workflow failure.
- Do not cancel native builds, notarization, store submission, or release mutation solely for unusual duration.
- Compare a suspected hang with the same step's successful baseline and job timeout. Obtain terminal logs before changing code when live logs are unavailable.
- Cancel a superseded run only when it cannot satisfy the outcome and blocks a corrected run; preserve candidate/status evidence required for resume.

## Terminal proof

Verify exact run SHA/attempt; immutable candidates and grouped verification; required validation suites; rolling promotions; requested desktop/mobile/Docker surfaces; promoted-reference verification; `happier-release-status` with complete required surfaces and terminal `published`; and immutable/rolling tags at the expected source SHA. Report a best-effort side-lane failure separately even when the workflow is terminal-green.

A surface projected as `published` or `accepted` is not sufficient proof when publishers were skipped, `identity.verified` is false, or promoted-reference verification failed. Verify the actual release artifacts and tag/source identity; do not promote a status projection into a successful parent-nightly result.

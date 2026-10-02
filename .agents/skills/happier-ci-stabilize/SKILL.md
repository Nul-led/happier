---
name: happier-ci-stabilize
description: Stabilize Happier CI and release workflows by collecting every failure from one exact run, clustering shared causes, simplifying stale tests and harnesses without weakening coverage, validating coherent fix batches efficiently, and recovering failed nightlies through the cheapest safe rerun or verified-candidate resume path. Use for failing, flaky, slow, repeatedly rerun, or over-complicated CI/nightly workflows.
---

# Happier CI Stabilization

Drive a failing CI or release run to an evidence-backed terminal result with the fewest expensive reruns. This skill owns failure collection, stabilization sequencing, CI cleanup decisions, monitoring, and recovery selection. It does not grant release authority or replace the test-quality rules in `.agents/skills/happier-testing`.

## Load the owning workflows

- Read and apply `.agents/skills/happier-testing/SKILL.md` before changing tests, fixtures, mocks, testkits, timeouts, or lane selection.
- Use `.agents/skills/happier-implement/SKILL.md` for repository corrections and its RED -> GREEN requirement for behavior changes.
- Resolve privileged publication through `.agents/skills/happier-release/SKILL.md`; this skill never invents release authority.

Read [failure-collection.md](references/failure-collection.md) for a failing run, [ci-cleanup.md](references/ci-cleanup.md) before simplifying CI/tests, and [nightly-recovery.md](references/nightly-recovery.md) before rerunning or resuming a release.

## Fast stabilization loop

1. **Bind exact identity.** Record repository, workflow, run ID, attempt, event, head SHA, status, and branch. Do not diagnose “latest” after the branch has moved.
2. **Collect the whole reachable failure set.** Let independent jobs reach terminal state unless continued execution is unsafe, produces conflicting publication writes, or a proven wedged job blocks the corrected run. Do not begin a rerun from the first red annotation while other independent lanes can still expose failures.
3. **Use the collector.** Run `node skills/happier-ci-stabilize/scripts/collect-actions-failures.mjs --repo happier-dev/happier --run-id <run-id> [--attempt <n>]` after the attempt is terminal. It paginates all jobs and retains full failed-job logs outside the repository while returning compact evidence. Keep the working inventory in the conversation or `/tmp`, not a repository ledger.
4. **Cluster before fixing.** Collapse aggregator failures and many test symptoms into their originating signature and canonical owner. One stale shared harness can fail dozens of scenarios; do not count those as dozens of defects.
5. **Classify from evidence.** Use the shared testing taxonomy: production defect, stale test/expectation, harness/mock defect, release-control/setup defect, external service/configuration defect, resource/timeout defect, or inconclusive. Record dependent symptoms separately from the earliest cause. A timeout is a symptom until logs and step timing establish the cause.
6. **Correct one coherent batch.** Reproduce the smallest owner-level failure locally, prove RED for the intended contract, fix the canonical owner, and update or remove only assertions/harnesses invalidated by that same cause. Preserve unrelated dirty work.
7. **Validate once per widening boundary.** Run all corrected focused tests together, then each affected package/lane, then canonical CI once for the coherent batch. Default to GitHub-hosted runners. Use a manual Blacksmith pool only with explicit current approval and confirmed remaining included budget; keep runner-sensitive, secret-bearing, macOS, and Windows lanes on their proven runners.
8. **Recover instead of rebuilding.** Choose native failed-job rerun, verified-candidate resume, or fresh release from the decision table in `nightly-recovery.md`. Never reuse artifacts after candidate/source bytes change.
9. **Monitor proportionally.** Poll ordinary transitions in roughly 1-2 minutes only when a result is expected immediately. Poll dependency installs, full suites, builds, signing, notarization, store submission, and publication every 5-20 minutes. Long duration alone is not failure evidence.
10. **Close from independent evidence.** Require the canonical CI result for the exact SHA. For a nightly, also inspect `happier-release-status`, immutable candidate identities, promoted-reference verification, rolling tags, and the terminal status owner. A green top-level badge alone is not the release proof.

### Iterate narrowly; certify once

After one complete terminal collection, reproduce every deterministic cluster
with the smallest owner-level command, run all corrected focused suites
together, and then run each affected package lane. When the local environment
cannot represent the hosted boundary, dispatch the existing manual workflow
with only the affected custom checks/specs on the corrected exact SHA. Use
`runner_pool=github` by default. A Blacksmith pool is only for explicitly
approved, budget-checked, non-secret Linux lanes; do not copy the workflow graph
or assume a paid fallback. Run the required full/release profile once after the
coherent correction batch is ready.

A native failed-job rerun retries the same workflow bytes and SHA. It is the
right tool for a safe transient failure, but cannot validate a fix that exists
only in a newer commit. A focused dispatch is fast diagnostic evidence and
does not replace the final exact-SHA profile required by release policy.

## Keep source CI and release admission separate

- Source CI proves code correctness once for an exact SHA.
- Release preflight cheaply validates the requested channel, versions, notes,
  protocol/tools, credentials, external configuration, and platform inputs.
- Release consumes explicit exact-SHA CI evidence when available; it does not
  rerun the source suite.
- Candidate/signature/install/update/store/promoted-reference validation stays
  after the real artifact exists and runs in parallel where prerequisites
  permit.

## Make one run expose more failures

When changing workflow structure, preserve these boundaries:

- Independent test jobs should not depend on unrelated test jobs.
- Independent checks inside one job may use `continue-on-error` only when a final `if: always()` aggregator fails the job if any required check failed.
- Diagnostic artifact upload and terminal status projection should use `if: always()` where safe.
- Publication, promotion, signing, destructive mutation, and security/trust gates remain fail-closed and must not continue merely to collect more errors.
- A collector exposes all **reachable** failures. A downstream job gated on a missing candidate cannot be meaningfully tested until that prerequisite exists; do not label this unavoidable dependency as hidden CI failure.

Prefer moving cheap, deterministic release contracts, workflow parsing, configuration preflights, generated-output checks, and package-size projections before expensive native builds. Do not duplicate production logic in a preflight; call the canonical owner or inspect its output.

## Stop conditions

Stop and report rather than retry when:

- the origin run is still active and resume validation requires a terminal status artifact;
- source or candidate bytes changed but the proposed recovery would reuse old artifacts;
- a release mutation returned an ambiguous failure and current external state has not been reconciled;
- expected behavior is a product decision rather than an observable current contract;
- logs are unavailable and the remaining evidence cannot distinguish product, test, harness, or infrastructure failure.

## Handoff

Report:

- exact run/attempt/SHA and whether collection was complete;
- every root-cause cluster and its classification;
- focused RED/GREEN evidence and broader lanes actually run;
- tests, mocks, timeouts, or workflow gates consolidated/removed and why coverage did not weaken;
- recovery mechanism used and what work it preserved;
- terminal CI/release evidence and residual risk.

## Fast CI evidence handoff

When a completed canonical push CI run is already known, pass its numeric run ID to release/nightly dispatch as `ci_run_id`. The workflow verifies repository, workflow path, branch, exact head SHA, push event, completion, and success; it never trusts the ID alone. This avoids occupying a hosted runner with `gh run watch`. If no run ID is supplied, the exact-SHA lookup remains the unattended fallback.
